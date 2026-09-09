/*!
 * Cloud Launchpad — front-end behaviour
 *
 * Vanilla ES2019, no dependencies, no build step. Everything here is a
 * progressive enhancement: with JavaScript disabled the page is still fully
 * readable and navigable, which matters when the whole site is a handful of
 * static objects sitting in an S3 bucket.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  /* ----------------------------------------------------------------------
   * Theme
   * Order of precedence: explicit user choice → operating-system preference.
   * -------------------------------------------------------------------- */
  var Theme = {
    KEY: 'cloud-launchpad:theme',

    read: function () {
      try { return localStorage.getItem(this.KEY); } catch (e) { return null; }
    },

    write: function (value) {
      try { localStorage.setItem(this.KEY, value); } catch (e) { /* private mode */ }
    },

    apply: function (value) {
      root.setAttribute('data-theme', value);
      var meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', value === 'light' ? '#eef1f9' : '#070b16');

      var btn = $('#theme-toggle');
      if (btn) {
        var next = value === 'light' ? 'dark' : 'light';
        btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
        btn.setAttribute('aria-pressed', String(value === 'light'));
      }
    },

    init: function () {
      var stored = this.read();
      var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      this.apply(stored || (prefersLight ? 'light' : 'dark'));

      var btn = $('#theme-toggle');
      if (btn) {
        btn.addEventListener('click', function () {
          var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
          Theme.apply(next);
          Theme.write(next);
        });
      }

      // Follow the OS only while the visitor has not made a choice.
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
        if (!Theme.read()) Theme.apply(e.matches ? 'light' : 'dark');
      });
    }
  };

  /* ----------------------------------------------------------------------
   * Header: translucent background once the page has scrolled.
   * -------------------------------------------------------------------- */
  function initHeader() {
    var header = $('.site-header');
    if (!header) return;

    var ticking = false;
    function update() {
      header.classList.toggle('is-stuck', window.scrollY > 12);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ----------------------------------------------------------------------
   * Mobile navigation.
   * -------------------------------------------------------------------- */
  function initNav() {
    var toggle = $('#nav-toggle');
    var nav = $('#primary-nav');
    if (!toggle || !nav) return;

    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', (open ? 'Close' : 'Open') + ' navigation');
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setOpen(false);
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    doc.addEventListener('click', function (e) {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (!nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
    });
  }

  /* ----------------------------------------------------------------------
   * Scroll reveal. IntersectionObserver only — no scroll-position maths.
   * -------------------------------------------------------------------- */
  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var delay = el.getAttribute('data-reveal-delay');
        if (delay) el.style.setProperty('--reveal-delay', delay + 'ms');
        el.classList.add('is-visible');
        observer.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    items.forEach(function (el) { observer.observe(el); });
  }

  /* ----------------------------------------------------------------------
   * Active section highlighting in the primary navigation.
   * -------------------------------------------------------------------- */
  function initScrollSpy() {
    var links = $$('.nav a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    var sections = links.map(function (link) {
      var section = doc.getElementById(link.getAttribute('href').slice(1));
      if (section) map[section.id] = link;
      return section;
    }).filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (l) { l.classList.remove('is-active'); });
        var active = map[entry.target.id];
        if (active) active.classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (s) { observer.observe(s); });
  }

  /* ----------------------------------------------------------------------
   * Pointer spotlight on cards. Purely decorative, pointer devices only.
   * -------------------------------------------------------------------- */
  function initSpotlight() {
    if (reduceMotion || !window.matchMedia('(hover: hover)').matches) return;

    $$('[data-spotlight]').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
      });
    });
  }

  /* ----------------------------------------------------------------------
   * Count-up statistics.
   * -------------------------------------------------------------------- */
  function initCounters() {
    var counters = $$('[data-count-to]');
    if (!counters.length) return;

    function render(el, value) {
      var suffix = el.getAttribute('data-count-suffix') || '';
      el.textContent = String(value) + suffix;
    }

    function run(el) {
      var target = parseInt(el.getAttribute('data-count-to'), 10) || 0;
      if (reduceMotion || target === 0) { render(el, target); return; }

      var duration = 1200;
      var start = null;

      function frame(now) {
        if (start === null) start = now;
        var progress = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        render(el, Math.round(target * eased));
        if (progress < 1) window.requestAnimationFrame(frame);
      }
      window.requestAnimationFrame(frame);
    }

    if (!('IntersectionObserver' in window)) {
      counters.forEach(function (el) { render(el, parseInt(el.getAttribute('data-count-to'), 10) || 0); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        run(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    counters.forEach(function (el) { observer.observe(el); });
  }

  /* ----------------------------------------------------------------------
   * Hero console: a scripted replay of the real deployment pipeline.
   * The steps mirror .github/workflows/deploy.yml so the illustration and
   * the implementation cannot drift apart silently.
   * -------------------------------------------------------------------- */
  function initConsole() {
    var log = $('#deploy-log');
    var bar = $('#deploy-progress');
    var status = $('#deploy-status');
    if (!log) return;

    var steps = [
      { t: '10:24:01', text: 'Checkout   main@a1c9f42', cls: 't' },
      { t: '10:24:03', text: 'CI         html, links and js validated', cls: 'ok' },
      { t: '10:24:07', text: 'Terraform  fmt · validate · plan  no changes', cls: 'ok' },
      { t: '10:24:11', text: 'Auth       assumed role via GitHub OIDC', cls: 'hl' },
      { t: '10:24:15', text: 'Sync       9 objects uploaded, 1 deleted', cls: 'em' },
      { t: '10:24:18', text: 'Cache      invalidation I2BQ7X created', cls: 'hl' },
      { t: '10:24:29', text: 'Verify     200 OK · build a1c9f42 live', cls: 'ok' },
      { t: '10:24:29', text: 'Deployed   https://d1x9k2p.cloudfront.net', cls: 'ok' }
    ];

    function line(step) {
      var el = doc.createElement('span');
      el.className = 'ln';

      var time = doc.createElement('span');
      time.className = 't';
      time.textContent = step.t + '  ';

      var body = doc.createElement('span');
      body.className = step.cls;
      body.textContent = step.text;

      el.appendChild(time);
      el.appendChild(body);
      return el;
    }

    function finish() {
      if (status) status.textContent = 'success';
      if (bar) bar.style.width = '100%';
      var cursor = doc.createElement('span');
      cursor.className = 'cursor';
      log.appendChild(cursor);
    }

    if (reduceMotion) {
      steps.forEach(function (s) { log.appendChild(line(s)); });
      finish();
      return;
    }

    var i = 0;
    function next() {
      if (i >= steps.length) { finish(); return; }
      log.appendChild(line(steps[i]));
      i += 1;
      if (bar) bar.style.width = Math.round((i / steps.length) * 100) + '%';
      if (status) status.textContent = i === steps.length ? 'success' : 'running';
      window.setTimeout(next, 420 + Math.random() * 260);
    }

    // Only start once the card is actually on screen.
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        window.setTimeout(next, 350);
      }, { threshold: 0.35 });
      observer.observe(log);
    } else {
      next();
    }
  }

  /* ----------------------------------------------------------------------
   * Build information.
   *
   * scripts/build.sh writes assets/build-info.json with the commit that
   * produced the deployment. Showing it in the footer turns "did my change go
   * out?" from a guess into a fact, and gives the pipeline's verification step
   * something concrete to assert against after every deploy.
   * -------------------------------------------------------------------- */
  function initBuildInfo() {
    var el = doc.getElementById('build-info');
    if (!el || !window.fetch) return;

    fetch('assets/build-info.json', { cache: 'no-cache' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (info) {
        if (!info || !info.shortCommit) return;

        if (info.commit === 'local') {
          el.textContent = 'local build · not deployed';
          return;
        }

        var when = '';
        if (info.builtAt) {
          when = ' · ' + info.builtAt.replace('T', ' ').replace('Z', ' UTC');
        }
        var label = 'build ' + info.shortCommit + ' · ' + (info.ref || 'unknown') + when;

        if (info.runUrl) {
          var link = doc.createElement('a');
          link.href = info.runUrl;
          link.rel = 'noopener';
          link.textContent = label;
          el.textContent = '';
          el.appendChild(link);
        } else {
          el.textContent = label;
        }
      })
      .catch(function () { /* the footer keeps its default text */ });
  }

  /* ----------------------------------------------------------------------
   * Boot
   * -------------------------------------------------------------------- */
  function init() {
    Theme.init();
    initHeader();
    initNav();
    initReveal();
    initScrollSpy();
    initSpotlight();
    initCounters();
    initConsole();
    initBuildInfo();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
