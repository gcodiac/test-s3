# Runbook

Operational procedures for the Cloud Launchpad platform. Written to be followed at
speed by somebody who did not build it.

---

## First deployment

### 1. Provision the infrastructure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit it
aws sts get-caller-identity                    # confirm the account first

terraform init
terraform plan                                 # read this
terraform apply
```

The CloudFront distribution takes a few minutes to reach `Deployed`. Terraform waits.

### 2. Wire up the pipeline

```bash
terraform output deployment_configuration
```

Set the values as **repository variables** — not secrets. None of them is
confidential, and marking non-secrets as secrets only makes CI logs unreadable.

```bash
cd ..
gh variable set AWS_REGION                 --body "eu-west-1"
gh variable set AWS_ROLE_ARN               --body "arn:aws:iam::<account>:role/<name>"
gh variable set S3_BUCKET                  --body "<bucket>"
gh variable set CLOUDFRONT_DISTRIBUTION_ID --body "<distribution id>"
gh variable set SITE_URL                   --body "https://<domain>.cloudfront.net"
```

The IAM role's trust policy must list the repository you are pushing from. If you
forked this project, set `github_repository` in `terraform.tfvars` to your fork and
re-apply, or every deployment fails at the role assumption step.

### 3. Deploy

Push to `main`, or run the workflow by hand:

```bash
gh workflow run deploy.yml
gh run watch
```

---

## Deploy from a laptop

Useful while the pipeline is still being built, and for debugging when it breaks.

```bash
make deploy       # build + sync to S3
make invalidate   # clear the CloudFront cache
make verify       # check the live site
```

Or without `make`:

```bash
export SITE_URL=$(cd infra && terraform output -raw site_url)
./scripts/build.sh
S3_BUCKET=$(cd infra && terraform output -raw bucket_name) ./scripts/deploy.sh
CLOUDFRONT_DISTRIBUTION_ID=$(cd infra && terraform output -raw cloudfront_distribution_id) \
  WAIT=1 ./scripts/invalidate.sh
```

---

## Roll back a bad deployment

Three options, fastest first.

### Re-deploy the previous commit

The pipeline is the rollback mechanism. This is almost always the right answer,
because it leaves the bucket in a state that matches a commit.

```bash
git revert <bad-commit>
git push origin main
```

Or re-run the last good deployment:

```bash
gh run list --workflow=deploy.yml --limit 10
gh run rerun <run-id>
```

### Restore previous object versions

Versioning is enabled on the bucket, so the previous objects still exist. Use this
when the pipeline itself is broken and you need the site fixed now.

```bash
BUCKET=$(cd infra && terraform output -raw bucket_name)

aws s3api list-object-versions --bucket "$BUCKET" --prefix index.html \
  --query 'Versions[?IsLatest==`false`].[VersionId,LastModified]' --output table

aws s3api copy-object --bucket "$BUCKET" --key index.html \
  --copy-source "$BUCKET/index.html?versionId=<previous-version-id>"
```

Then invalidate. Remember that the bucket now no longer matches any commit — follow up
with a real deployment.

### Roll back infrastructure

```bash
cd infra
git revert <bad-commit>
terraform plan     # confirm it removes what you expect
terraform apply
```

---

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The OIDC `sub` claim does not match the trust policy. Two common causes: a job using a GitHub Environment gets `…:environment:name` rather than `…:ref:refs/heads/main`; and GitHub may issue the *immutable* claim form `repo:owner@1234/name@5678:…` | Set `github_environment` in `terraform.tfvars` and re-apply. The configuration already matches both claim formats — see `local.github_subjects`. To see the claim your run actually presented, look up the failed `AssumeRoleWithWebIdentity` event in CloudTrail |
| Site returns 403 for everything | Bucket policy missing, or `AWS:SourceArn` does not match the distribution | `terraform apply`; check `aws_s3_bucket_policy.site` |
| Changes not visible after deploying | Edge cache still holding the old object | Run the invalidation; confirm with `curl -sI <url> \| grep -i x-cache` |
| A missing page returns 403 rather than 404 | Custom error responses not configured | Check `custom_error_response` on the distribution |
| Custom domain shows a certificate error | Certificate not in `us-east-1`, or not yet `ISSUED` | `terraform output acm_certificate_status`; certificates for CloudFront must be requested in `us-east-1` |
| `terraform destroy` fails on the bucket | The bucket still contains objects | Set `force_destroy_bucket = true` and re-apply, or empty it first |
| CI passes but deploy does nothing | The push touched no path in the workflow's `paths:` filter | Run `gh workflow run deploy.yml` |

Useful one-liners while debugging:

```bash
# What is the edge actually serving?
curl -sI https://<domain>/ | grep -iE 'x-cache|age|etag'

# Which build is live?
curl -s https://<domain>/assets/build-info.json

# Is the bucket genuinely private? This must return 403.
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<bucket>.s3.<region>.amazonaws.com/index.html"
```

---

## Check for drift

Drift is the gap between what Terraform believes and what AWS actually has — usually
created by somebody making a change in the console.

```bash
cd infra
terraform plan     # an empty plan means no drift
```

An unexpected diff means either the console was used, or someone changed the
configuration without applying it. Both are worth understanding before you apply.

---

## Tear it down

```bash
cd infra
terraform destroy
```

`force_destroy_bucket = true` is required for the bucket to be deleted while it still
contains the deployed site. Without it, `destroy` fails safely, which is the correct
default for anything holding data you would miss.

Afterwards, confirm nothing is left:

```bash
aws s3 ls | grep cloud-launchpad
aws cloudfront list-distributions --query 'DistributionList.Items[].DomainName'
```

The GitHub OIDC provider is shared account-wide. If another project uses it, set
`create_github_oidc_provider = false` before destroying so Terraform leaves it alone.
