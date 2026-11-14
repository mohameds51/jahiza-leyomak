/*
 * جاهزة ليومك — طبقة التتبع
 *
 * المبادئ:
 *  - لا يُحمَّل Meta Pixel ولا Clarity إلا بعد موافقة الزائرة، ولا يُحمَّلان أصلًا إذا لم تُضبط المعرّفات.
 *  - لا تُرسَل أي بيانات شخصية (لا بريد ولا اسم) إلى أي أداة تحليلات.
 *  - كل حدث له eventID فريد (يصلح لاحقًا لإزالة التكرار مع Conversions API).
 *  - الأحداث ذات الطبيعة الواحدة (ViewContent, PurchaseIntent, Lead, InitiateCheckout)
 *    تُرسل مرة واحدة لكل جلسة.
 *  - حدث Purchase ممنوع تمامًا من المتصفح. يجب أن يُرسل من الخادم بعد التحقق من الدفع (انظر README).
 */
(function () {
  'use strict';

  var cfgEl = document.getElementById('site-config');
  var ds = (cfgEl && cfgEl.dataset) || {};
  var MODE = ds.mode === 'LIVE_MODE' ? 'LIVE_MODE' : 'TEST_MODE';
  var PIXEL_ID = ds.pixelId || '';
  var CLARITY_ID = ds.clarityId || '';
  var CONFIGURED = Boolean(PIXEL_ID || CLARITY_ID);
  var DEBUG = /[?&]jl_debug=1(&|$)/.test(location.search);

  var CONSENT_KEY = 'jl_consent';
  var ONCE_PREFIX = 'jl_once_';

  var PRODUCT = { id: 'jahiza-leyomak', name: 'جاهزة ليومك', value: 99, currency: 'SAR' };

  // الأحداث المسموحة فقط. std=true تعني حدثًا قياسيًا في Meta.
  var EVENTS = {
    PageView:         { std: true },
    ViewContent:      { std: true,  product: true, value: true },
    PurchaseIntent:   { std: false, product: true },
    Lead:             { std: true },
    InitiateCheckout: { std: true,  product: true, value: true }
  };

  var queue = [];          // أحداث قبل أن تقرر الزائرة
  var providersLoaded = false;
  var log = (window.__jlEvents = window.__jlEvents || []); // للفحص عند ‎?jl_debug=1‎

  // ---------- تخزين آمن ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* تجاهل */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* تجاهل */ } }

  var memOnce = {}; // احتياط إذا كان sessionStorage غير متاح

  function onceSeen(name) { return Boolean(memOnce[name] || ssGet(ONCE_PREFIX + name)); }
  function onceMark(name) { memOnce[name] = 1; ssSet(ONCE_PREFIX + name, '1'); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getConsent() {
    var v = lsGet(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  }

  // ---------- تحميل المزودين (بعد الموافقة فقط) ----------
  function loadPixel(id) {
    if (window.fbq) return;
    var n = window.fbq = function () {
      if (n.callMethod) { n.callMethod.apply(n, arguments); } else { n.queue.push(arguments); }
    };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
    // إيقاف الإعداد التلقائي (يشمل Automatic Advanced Matching) لتجنب قراءة حقول النماذج.
    window.fbq('set', 'autoConfig', false, id);
    window.fbq('init', id);
  }

  function loadClarity(id) {
    if (window.clarity) return;
    window.clarity = function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.clarity.ms/tag/' + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  function loadProviders() {
    if (providersLoaded) return;
    providersLoaded = true;
    if (PIXEL_ID) loadPixel(PIXEL_ID);
    if (CLARITY_ID) loadClarity(CLARITY_ID);
  }

  // ---------- بناء المعاملات (بدون أي بيانات شخصية) ----------
  function buildParams(name) {
    var def = EVENTS[name];
    var p = { site_mode: MODE };
    if (def.product) {
      p.content_name = PRODUCT.name;
      p.content_ids = [PRODUCT.id];
      p.content_type = 'product';
    }
    if (def.value) {
      p.value = PRODUCT.value;
      p.currency = PRODUCT.currency;
    }
    return p;
  }

  function dispatch(evt) {
    if (PIXEL_ID && window.fbq) {
      if (evt.std) window.fbq('track', evt.name, evt.params, { eventID: evt.id });
      else window.fbq('trackCustom', evt.name, evt.params, { eventID: evt.id });
    }
    if (CLARITY_ID && window.clarity) {
      window.clarity('event', evt.name);
    }
    if (DEBUG) {
      log.push({ name: evt.name, id: evt.id, params: evt.params, sent: true });
      try { console.info('[jl] sent', evt.name, evt.params); } catch (e) { /* تجاهل */ }
    }
  }

  /**
   * track(name, { once: true })
   * يعيد true إذا أُرسل الحدث فعليًا إلى أداة تتبع، وfalse في غير ذلك.
   */
  function track(name, opts) {
    opts = opts || {};

    if (name === 'Purchase') {
      // قرار تصميمي: لا Purchase من المتصفح مهما كان السبب.
      try { console.warn('[jl] Purchase ممنوع من المتصفح. أرسله من الخادم بعد التحقق من الدفع.'); } catch (e) { /* تجاهل */ }
      return false;
    }
    if (!EVENTS[name]) {
      try { console.warn('[jl] حدث غير معروف:', name); } catch (e) { /* تجاهل */ }
      return false;
    }
    if (opts.once && onceSeen(name)) return false;

    var evt = { name: name, id: uuid(), params: buildParams(name), std: EVENTS[name].std, once: Boolean(opts.once) };

    if (!CONFIGURED) {
      if (DEBUG) {
        log.push({ name: name, id: evt.id, params: evt.params, sent: false, reason: 'no-provider' });
        try { console.info('[jl] not sent (no IDs configured)', name); } catch (e) { /* تجاهل */ }
      }
      return false;
    }

    var consent = getConsent();
    if (consent === 'denied') return false;

    if (consent === null) {
      // لم تقرر الزائرة بعد: نحتفظ بالحدث في الذاكرة فقط (يُحذف عند الرفض أو إغلاق الصفحة).
      var dup = false;
      if (evt.once) {
        for (var i = 0; i < queue.length; i++) if (queue[i].name === name) { dup = true; break; }
      }
      if (!dup && queue.length < 20) queue.push(evt);
      return false;
    }

    loadProviders();
    dispatch(evt);
    if (evt.once) onceMark(name);
    return true;
  }

  function flushQueue() {
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].once && onceSeen(q[i].name)) continue;
      loadProviders();
      dispatch(q[i]);
      if (q[i].once) onceMark(q[i].name);
    }
  }

  // ---------- الموافقة ----------
  function setConsent(value) {
    var previous = getConsent();
    lsSet(CONSENT_KEY, value);
    if (value === 'granted') {
      loadProviders();
      flushQueue();
    } else {
      queue = [];
      // إذا كانت المزودات محمّلة بالفعل في هذه الصفحة، نعيد التحميل لإيقافها.
      if (providersLoaded || previous === 'granted') location.reload();
    }
  }

  function initConsentUI() {
    var banner = document.getElementById('consent');
    var settingsBtn = document.getElementById('privacy-settings');
    if (!CONFIGURED || !banner) return;

    function show() { banner.hidden = false; document.body.classList.add('consent-open'); }
    function hide() { banner.hidden = true; document.body.classList.remove('consent-open'); }

    var accept = document.getElementById('consent-accept');
    var deny = document.getElementById('consent-deny');
    if (accept) accept.addEventListener('click', function () { hide(); setConsent('granted'); });
    if (deny) deny.addEventListener('click', function () { hide(); setConsent('denied'); });
    if (settingsBtn) settingsBtn.addEventListener('click', show);

    if (getConsent() === null) show();
  }

  // ---------- بدء التشغيل ----------
  window.JL = { track: track, mode: MODE, configured: CONFIGURED, getConsent: getConsent };

  function start() {
    initConsentUI();
    if (getConsent() === 'granted') loadProviders();
    track('PageView'); // مرة لكل تحميل للصفحة
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
