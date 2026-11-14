/* جاهزة ليومك — سلوك الصفحة: حركة خفيفة، شريط CTA، تتبع الضغط على CTA، ونموذج التسجيل قبل الإطلاق. */
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
    var updateSticky = function () {
      var blocked = Object.keys(state.blockers).some(function (k) { return state.blockers[k]; });
      var show = state.heroPassed && !state.heroVisible && !blocked;
      sticky.classList.toggle('is-visible', show);
      sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (stickyLink) stickyLink.tabIndex = show ? 0 : -1;
    };
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

  /* ---------- أزرار CTA ----------
     TEST_MODE: الرابط يقود إلى صفحة التسجيل قبل الإطلاق (/prelaunch). لا دفع ولا Purchase.
     LIVE_MODE: الرابط يقود إلى الدفع الحقيقي، ويُسجَّل InitiateCheckout.
     في الحالتين لا يُسجَّل Purchase من المتصفح أبدًا. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-cta]') : null;
    if (!el) return;
    var plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

    var sent = JL.track('PurchaseIntent', { once: true });
    if (MODE === 'LIVE_MODE') {
      sent = JL.track('InitiateCheckout', { once: true }) || sent;
    }

    var url = el.getAttribute('href');
    if (sent && plain && url && url.charAt(0) !== '#') {
      // مهلة قصيرة لإتمام إرسال الحدث قبل مغادرة الصفحة.
      e.preventDefault();
      setTimeout(function () { location.href = url; }, 250);
    }
  });

  /* ---------- نموذج التسجيل قبل الإطلاق (صفحة /prelaunch) ---------- */
  var form = document.getElementById('lead-form');
  if (form) {
    var nameEl = document.getElementById('lead-name');
    var emailEl = document.getElementById('lead-email');
    var waEl = document.getElementById('lead-whatsapp');
    var consentEl = document.getElementById('lead-consent');
    var companyEl = document.getElementById('lead-company');
    var statusEl = document.getElementById('lead-status');
    var wrapEl = document.getElementById('lead-wrap');
    var successEl = document.getElementById('lead-success');
    var submitEl = document.getElementById('lead-submit');
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    var setStatus = function (msg, kind) {
      statusEl.textContent = msg || '';
      statusEl.setAttribute('data-kind', kind || 'info');
    };
    var setState = function (s) {
      form.setAttribute('data-state', s);
      submitEl.disabled = s === 'loading';
    };
    var invalid = function (el, bad) { el.setAttribute('aria-invalid', bad ? 'true' : 'false'); };

    // يقبل الأرقام العربية الهندية (٠-٩) ويزيل المسافات والشرطات والأقواس.
    // يعيد '' إن كان الحقل فارغًا، وnull إن كان الرقم غير صالح.
    var normalizePhone = function (v) {
      v = (v || '').trim();
      if (!v) return '';
      v = v.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
      v = v.replace(/[\s\-().]/g, '');
      return /^\+?\d{8,15}$/.test(v) ? v : null;
    };

    var utm = function () {
      var out = {};
      try {
        var p = new URLSearchParams(location.search);
        ['utm_source', 'utm_campaign'].forEach(function (k) {
          var v = p.get(k);
          if (v) out[k] = v.slice(0, 100);
        });
      } catch (err) { /* تجاهل */ }
      return out;
    };

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (form.getAttribute('data-state') === 'loading') return;

      var firstName = nameEl.value.replace(/\s+/g, ' ').trim();
      var email = emailEl.value.trim();
      var wa = normalizePhone(waEl.value);

      var nameOk = firstName.length >= 1 && firstName.length <= 60;
      var emailOk = email.length <= 254 && EMAIL_RE.test(email);
      invalid(nameEl, !nameOk); invalid(emailEl, !emailOk); invalid(waEl, wa === null);

      if (!nameOk) { setStatus('اكتبي اسمك الأول.', 'error'); nameEl.focus(); return; }
      if (!emailOk) { setStatus('تأكدي من كتابة البريد الإلكتروني بشكل صحيح.', 'error'); emailEl.focus(); return; }
      if (wa === null) { setStatus('رقم الواتساب غير صحيح. اتركيه فارغًا إن لم ترغبي بإضافته.', 'error'); waEl.focus(); return; }
      if (!consentEl.checked) { setStatus('نحتاج موافقتك لحفظ بياناتك.', 'error'); consentEl.focus(); return; }

      setState('loading');
      setStatus('جارٍ التسجيل…', 'info');

      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;

      try {
        var payload = Object.assign(
          { first_name: firstName, email: email, consent: true, company: companyEl ? companyEl.value : '' },
          wa ? { whatsapp: wa } : {},
          utm()
        );
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
          JL.track('Lead', { once: true }); // يُرسل فقط بعد نجاح مؤكد من الخادم، وبلا أي بيانات شخصية
          return;
        }

        setState('error');
        if (res.status === 503) setStatus('التسجيل غير متاح حاليًا، جربي لاحقًا.', 'error');
        else if (res.status === 400) setStatus('تأكدي من بياناتك ومن الموافقة ثم جربي مرة ثانية.', 'error');
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
