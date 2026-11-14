/* جاهزة ليومك — سلوك الصفحة: حركة خفيفة، شريط CTA، نافذة TEST_MODE، نموذج الاهتمام. */
(function () {
  'use strict';

  var cfgEl = document.getElementById('site-config');
  var ds = (cfgEl && cfgEl.dataset) || {};
  var MODE = ds.mode === 'LIVE_MODE' ? 'LIVE_MODE' : 'TEST_MODE';
  var JL = window.JL || { track: function () { return false; } };
  var hasIO = 'IntersectionObserver' in window;

  /* ---------- ظهور تدريجي (بدون التأثير على LCP: الـ Hero غير مشمول) ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (hasIO) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); revealIO.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { revealIO.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- ViewContent: عند ظهور تفاصيل المنتج (قسم الأدوات) ---------- */
  var tools = document.getElementById('tools');
  if (tools && hasIO) {
    var vcIO = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        JL.track('ViewContent', { once: true });
        vcIO.disconnect();
      }
    }, { threshold: 0.2 });
    vcIO.observe(tools);
  }

  /* ---------- شريط CTA الثابت (جوال) ---------- */
  var sticky = document.getElementById('sticky-cta');
  var heroCta = document.getElementById('hero-cta');
  if (sticky && heroCta && hasIO) {
    var stickyLink = sticky.querySelector('a');
    var state = { heroVisible: true, heroPassed: false, blockers: {} };
    function updateSticky() {
      var blocked = Object.keys(state.blockers).some(function (k) { return state.blockers[k]; });
      var show = state.heroPassed && !state.heroVisible && !blocked;
      sticky.classList.toggle('is-visible', show);
      sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (stickyLink) stickyLink.tabIndex = show ? 0 : -1;
    }
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      state.heroVisible = e.isIntersecting;
      if (!e.isIntersecting && e.boundingClientRect.top < 0) state.heroPassed = true;
      if (e.isIntersecting) state.heroPassed = false;
      updateSticky();
    }).observe(heroCta);
    ['price', 'final'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      new IntersectionObserver(function (entries) {
        state.blockers[id] = entries[entries.length - 1].isIntersecting;
        updateSticky();
      }, { threshold: 0.15 }).observe(el);
    });
  }

  /* ---------- النافذة (TEST_MODE) ---------- */
  var dlg = document.getElementById('preorder');

  function openDialog() {
    if (!dlg) return false;
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
    return true;
  }
  function closeDialog() {
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    document.body.style.overflow = '';
  }
  if (dlg) {
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(); });
    dlg.addEventListener('close', function () { document.body.style.overflow = ''; });
    dlg.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeDialog); });
  }

  /* ---------- أزرار CTA ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-cta]') : null;
    if (!el) return;
    var plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

    // نية الشراء: في الوضعين، مرة واحدة لكل جلسة.
    JL.track('PurchaseIntent', { once: true });

    if (MODE === 'TEST_MODE') {
      // لا دفع ولا Purchase. نفتح رسالة «قيد التجهيز».
      if (openDialog()) e.preventDefault();
      return; // إن لم تتوفر النافذة يعمل الرابط #price كبديل
    }

    // LIVE_MODE: بدء دفع حقيقي. (Purchase لا يُرسل من هنا أبدًا.)
    var sent = JL.track('InitiateCheckout', { once: true });
    var url = el.getAttribute('href');
    if (sent && plain && url) {
      e.preventDefault();
      setTimeout(function () { location.href = url; }, 250); // مهلة قصيرة لإتمام إرسال الحدث
    }
  });

  /* ---------- نموذج تسجيل الاهتمام (يظهر فقط إذا LEAD_CAPTURE=on) ---------- */
  var form = document.getElementById('lead-form');
  if (form) {
    var emailEl = document.getElementById('lead-email');
    var consentEl = document.getElementById('lead-consent');
    var companyEl = document.getElementById('lead-company');
    var statusEl = document.getElementById('lead-status');
    var wrapEl = document.getElementById('lead-wrap');
    var successEl = document.getElementById('lead-success');
    var submitEl = document.getElementById('lead-submit');
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    function setStatus(msg, kind) {
      statusEl.textContent = msg || '';
      statusEl.setAttribute('data-kind', kind || 'info');
    }
    function setState(s) {
      form.setAttribute('data-state', s);
      submitEl.disabled = s === 'loading';
    }
    function utm() {
      var out = {};
      try {
        var p = new URLSearchParams(location.search);
        ['utm_source', 'utm_campaign'].forEach(function (k) {
          var v = p.get(k);
          if (v) out[k] = v.slice(0, 100);
        });
      } catch (err) { /* تجاهل */ }
      return out;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (form.getAttribute('data-state') === 'loading') return;

      var email = emailEl.value.trim();
      var valid = email.length <= 254 && EMAIL_RE.test(email);
      emailEl.setAttribute('aria-invalid', valid ? 'false' : 'true');
      if (!valid) { setStatus('تأكدي من كتابة البريد الإلكتروني بشكل صحيح.', 'error'); emailEl.focus(); return; }
      if (!consentEl.checked) { setStatus('نحتاج موافقتك لحفظ البريد.', 'error'); consentEl.focus(); return; }

      setState('loading');
      setStatus('جارٍ التسجيل…', 'info');

      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;

      try {
        var payload = Object.assign({ email: email, consent: true, company: companyEl ? companyEl.value : '' }, utm());
        var res = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl ? ctrl.signal : undefined
        });
        if (timer) clearTimeout(timer);

        var data = null;
        try { data = await res.json(); } catch (err) { /* تجاهل */ }

        if (res.ok && data && data.ok === true) {
          setState('success');
          setStatus('', 'info');
          wrapEl.hidden = true;
          successEl.hidden = false;
          successEl.tabIndex = -1;
          successEl.focus();
          JL.track('Lead', { once: true }); // يُرسل فقط بعد نجاح مؤكد من الخادم
          return;
        }

        setState('error');
        if (res.status === 503) setStatus('تسجيل الاهتمام غير متاح حاليًا، جربي لاحقًا.', 'error');
        else if (res.status === 400) setStatus('تأكدي من البريد الإلكتروني ومن الموافقة ثم جربي مرة ثانية.', 'error');
        else if (res.status === 429) setStatus('محاولات كثيرة، جربي بعد شوي.', 'error');
        else setStatus('صار خطأ بسيط، جربي مرة ثانية بعد شوي.', 'error');
      } catch (err) {
        if (timer) clearTimeout(timer);
        setState('error');
        setStatus('تعذر الاتصال. تأكدي من الإنترنت وجربي مرة ثانية.', 'error');
      }
    });
  }
})();
