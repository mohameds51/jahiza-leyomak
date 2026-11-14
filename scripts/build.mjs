// بناء الموقع: يقرأ متغيرات البيئة، يتحقق منها، ويولّد مجلد dist/ جاهزًا للنشر.
// لا توجد أي حزم مطلوبة لهذه الخطوة (Node فقط).

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, cpSync,
  readdirSync, statSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public');
const OUT = join(ROOT, 'dist');

// ---------- تحميل .env محليًا (القيم الموجودة في البيئة لها الأولوية) ----------
function loadDotEnv(names) {
  for (const name of names) {
    const p = join(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}
loadDotEnv(['.env.local', '.env']);

const env = (k, d = '') => String(process.env[k] ?? d).trim();

// ---------- قراءة والتحقق ----------
const errors = [];
const MODE = env('SITE_MODE', 'TEST_MODE') || 'TEST_MODE';
if (!['TEST_MODE', 'LIVE_MODE'].includes(MODE)) {
  errors.push(`SITE_MODE يجب أن تكون TEST_MODE أو LIVE_MODE (القيمة الحالية: "${MODE}").`);
}

const PIXEL_ID = env('META_PIXEL_ID');
if (PIXEL_ID && !/^\d{8,20}$/.test(PIXEL_ID)) {
  errors.push('META_PIXEL_ID يجب أن يكون أرقامًا فقط (من 8 إلى 20 رقمًا).');
}

const CLARITY_ID = env('CLARITY_PROJECT_ID');
if (CLARITY_ID && !/^[a-z0-9]{8,12}$/i.test(CLARITY_ID)) {
  errors.push('CLARITY_PROJECT_ID غير صالح (حروف وأرقام إنجليزية فقط، 8–12 خانة).');
}

let SITE_URL = env('SITE_URL').replace(/\/+$/, '');
if (SITE_URL && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(SITE_URL)) {
  errors.push('SITE_URL يجب أن يبدأ بـ https:// (مثال: https://example.com).');
}

const CONTACT_EMAIL = env('CONTACT_EMAIL');
if (CONTACT_EMAIL && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(CONTACT_EMAIL)) {
  errors.push('CONTACT_EMAIL ليس بريدًا صالحًا.');
}

const LEAD_CAPTURE = env('LEAD_CAPTURE', 'off').toLowerCase();
if (!['on', 'off'].includes(LEAD_CAPTURE)) errors.push('LEAD_CAPTURE يجب أن تكون on أو off.');

const CTA_LABEL = env('CTA_LABEL', 'ابدئي تجهيزاتك بـ99 ريال') || 'ابدئي تجهيزاتك بـ99 ريال';
if (CTA_LABEL.length > 40) errors.push('CTA_LABEL طويل جدًا (الحد 40 حرفًا).');
// نص مختصر للأماكن الضيقة (الترويسة والشريط الثابت على الجوال).
const CTA_SHORT_LABEL = env('CTA_SHORT_LABEL', 'ابدئي الآن') || 'ابدئي الآن';
if (CTA_SHORT_LABEL.length > 20) errors.push('CTA_SHORT_LABEL طويل جدًا (الحد 20 حرفًا).');

const CHECKOUT_URL = env('LIVE_CHECKOUT_URL');
if (MODE === 'LIVE_MODE') {
  if (env('LIVE_READY_CONFIRMED').toLowerCase() !== 'yes') {
    errors.push(
      'LIVE_MODE مرفوض: لم تُفعَّل بوابة الأمان. اكتب LIVE_READY_CONFIRMED=yes فقط بعد جاهزية المنتج وربط Paddle واختبار التسليم فعليًا.'
    );
  }
  if (!/^https:\/\/[^\s"'<>]+$/.test(CHECKOUT_URL)) {
    errors.push('LIVE_MODE يحتاج LIVE_CHECKOUT_URL صالحًا يبدأ بـ https://');
  }
}
if (MODE === 'TEST_MODE') {
  // صفحة /prelaunch تعرض النموذج دائمًا في TEST_MODE. بدون هذا الإعداد لن يُحفظ أي تسجيل.
  // ليس خطأ قاتلًا (قد يكون DATABASE_URL مضبوطًا في بيئة التشغيل فقط)، لكن نحذّر.
  if (LEAD_CAPTURE !== 'on') {
    console.warn('⚠️  LEAD_CAPTURE ليس on: نموذج /prelaunch سيظهر لكن التسجيل لن يُحفظ (سيعرض «التسجيل غير متاح حاليًا»). فعّله مع DATABASE_URL عندما تكون جاهزة.');
  } else if (!env('DATABASE_URL')) {
    console.warn('⚠️  LEAD_CAPTURE=on لكن DATABASE_URL غير موجود في بيئة البناء. تأكد من ضبطه في Vercel، وإلا سيفشل التسجيل برسالة واضحة.');
  }
}

if (errors.length) {
  console.error('\n❌ فشل البناء بسبب إعدادات غير صالحة:\n');
  for (const e of errors) console.error('  • ' + e);
  console.error('');
  process.exit(1);
}

// ---------- أدوات القوالب ----------
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isTest = MODE === 'TEST_MODE';
const flags = {
  TEST: isTest,
  LIVE: !isTest,
  LEAD: isTest && LEAD_CAPTURE === 'on',
  TRACKING: Boolean(PIXEL_ID || CLARITY_ID),
};

function assetVersion() {
  const h = createHash('sha1');
  for (const sub of ['assets/app.css', 'assets/tracker.js', 'assets/app.js']) {
    const p = join(SRC, sub);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  return h.digest('hex').slice(0, 10);
}

const ogTags = (() => {
  const title = 'جاهزة ليومك | برنامج تجهيز العروس في آخر 30 يومًا';
  const desc = 'خطة شخصية وأدوات تنظيم ومتابعة لآخر 30 يومًا قبل الزفاف. 99 ريال سعودي.';
  const parts = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="ar_SA">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  if (SITE_URL) {
    parts.push(`<meta property="og:url" content="${esc(SITE_URL)}/">`);
    parts.push(`<meta property="og:image" content="${esc(SITE_URL)}/images/og-image.jpg">`);
    parts.push(`<meta property="og:image:width" content="1200">`);
    parts.push(`<meta property="og:image:height" content="630">`);
    parts.push(`<link rel="canonical" href="${esc(SITE_URL)}/">`);
  }
  return parts.join('\n  ');
})();

const ctx = {
  // قيم تُهرَّب تلقائيًا
  MODE,
  PIXEL_ID,
  CLARITY_ID,
  CHECKOUT_URL: isTest ? '' : CHECKOUT_URL,
  LEAD_ENABLED: flags.LEAD ? 'true' : 'false',
  CTA_LABEL,
  CTA_SHORT_LABEL,
  // TEST_MODE: صفحة التسجيل قبل الإطلاق. LIVE_MODE: رابط الدفع الحقيقي.
  CTA_HREF: isTest ? '/prelaunch' : CHECKOUT_URL,
  CTA_ATTRS_HTML: isTest ? '' : 'rel="noopener"',
  // في LIVE_MODE لا تُستخدم صفحة التسجيل: نحوّل من يصلها (رابط قديم أو إعلان) إلى الصفحة الرئيسية.
  PRELAUNCH_HEAD_HTML: isTest ? '' : '<meta http-equiv="refresh" content="0; url=/">',
  ASSET_V: assetVersion(),
  YEAR: String(new Date().getFullYear()),
  // قيم HTML خام (لاحقة _HTML)
  ROBOTS_HTML: isTest ? '<meta name="robots" content="noindex, nofollow">' : '',
  OG_TAGS_HTML: ogTags,
  CONTACT_BLOCK_HTML: CONTACT_EMAIL
    ? `<p>للتواصل بخصوص بياناتك: <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a></p>`
    : '',
};

function render(html, file) {
  // 1) الكتل الشرطية: <!--[NAME]-->...<!--[/NAME]-->
  let prev;
  let guard = 0;
  do {
    prev = html;
    html = html.replace(/<!--\[([A-Z]+)\]-->([\s\S]*?)<!--\[\/\1\]-->/g, (_, name, inner) => {
      if (!(name in flags)) throw new Error(`${file}: كتلة شرطية غير معروفة [${name}]`);
      return flags[name] ? inner : '';
    });
  } while (html !== prev && ++guard < 10);

  // 2) الرموز {{KEY}}
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in ctx)) throw new Error(`${file}: رمز غير معرّف {{${key}}}`);
    return key.endsWith('_HTML') ? ctx[key] : esc(ctx[key]);
  });

  if (/<!--\[\/?[A-Z]+\]-->/.test(html)) throw new Error(`${file}: كتلة شرطية غير مغلقة.`);
  return html;
}

// ---------- التنفيذ ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function walk(dir, base = '') {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(abs).isDirectory()) {
      mkdirSync(join(OUT, rel), { recursive: true });
      walk(abs, rel);
    } else if (extname(name) === '.html') {
      writeFileSync(join(OUT, rel), render(readFileSync(abs, 'utf8'), rel));
    } else {
      cpSync(abs, join(OUT, rel));
    }
  }
}
walk(SRC);

// لا نمنع الزحف حتى في TEST_MODE: زواحف Meta تحتاج الوصول لمراجعة الإعلانات.
// منع الفهرسة يتم عبر وسم noindex فقط.
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');

console.log('✅ تم البناء → dist/');
console.log(`   الوضع:            ${MODE}`);
console.log(`   Meta Pixel:       ${PIXEL_ID ? 'مفعّل' : 'غير مضبوط'}`);
console.log(`   Clarity:          ${CLARITY_ID ? 'مفعّل' : 'غير مضبوط'}`);
console.log(`   زر CTA يقود إلى:  ${isTest ? '/prelaunch (تسجيل قبل الإطلاق، بلا دفع)' : CHECKOUT_URL}`);
console.log(`   حفظ التسجيل:      ${flags.LEAD ? 'مفعّل (يحتاج DATABASE_URL)' : (isTest ? 'غير مفعّل: التسجيل لن يُحفظ' : 'غير مستخدم في LIVE_MODE')}`);
console.log(`   فهرسة المحركات:   ${isTest ? 'ممنوعة (noindex)' : 'مسموحة'}`);
