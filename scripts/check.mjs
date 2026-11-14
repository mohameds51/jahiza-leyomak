// فحوصات ثابتة على مجلد dist/ بعد البناء: روابط، معرّفات، صور، كلمات ممنوعة.
// الاستخدام: npm run build && npm run check
// ملاحظة: هذه الفحوصات تتأكد من البنية فقط، ولا تغني عن فتح الصفحة على جوال حقيقي.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(DIST)) { console.error('شغّل npm run build أولًا.'); process.exit(1); }

const failures = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);

const pages = readdirSync(DIST).filter((f) => f.endsWith('.html'));
const siteMode = (readFileSync(join(DIST, 'index.html'), 'utf8').match(/<html[^>]*data-mode="([^"]+)"/) || [])[1];

function resolveLocal(ref) {
  let p = ref.split('#')[0].split('?')[0];
  if (p === '' || p === '/') return join(DIST, 'index.html');
  const abs = join(DIST, p);
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  if (existsSync(abs + '.html')) return abs + '.html';
  return null;
}

for (const page of pages) {
  const html = readFileSync(join(DIST, page), 'utf8');

  // 1) بقايا قوالب
  if (/\{\{[A-Z_]+\}\}/.test(html)) fail(page, 'بقي رمز {{...}} غير مستبدل');
  if (/<!--\[\/?[A-Z]+\]-->/.test(html)) fail(page, 'بقيت كتلة شرطية');

  // 1b) هروب HTML خاطئ داخل الوسوم (مثل role=&quot;button&quot;)
  if (/=&quot;|&quot;[\s>]/.test(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ''))) fail(page, 'علامات &quot; ظاهرة داخل وسم (attribute مكسور)');

  // 2) lang / dir
  if (!/<html[^>]*lang="ar"[^>]*dir="rtl"/.test(html)) fail(page, 'lang="ar" dir="rtl" مفقودان');

  // 3) معرّفات مكررة
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) { if (seen.has(id)) fail(page, `id مكرر: ${id}`); seen.add(id); }

  // 4) الروابط والمراجع المحلية
  const refs = [];
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\s(?:srcset|imagesrcset)="([^"]+)"/g)) {
    for (const part of m[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
  }
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(ref) || ref.startsWith('//')) continue;
    if (ref.startsWith('#')) {
      if (ref.length > 1 && !seen.has(ref.slice(1))) fail(page, `مرساة غير موجودة: ${ref}`);
      continue;
    }
    if (!ref.startsWith('/')) { fail(page, `مسار نسبي غير متوقع: ${ref}`); continue; }
    if (!resolveLocal(ref)) fail(page, `ملف غير موجود: ${ref}`);
    const hash = ref.split('#')[1];
    if (hash && resolveLocal(ref) && resolveLocal(ref).endsWith('index.html') && !seen.has(hash) && page === 'index.html') {
      fail(page, `مرساة غير موجودة: ${ref}`);
    }
  }

  // 5) الصور
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\salt="[^"]+"/.test(tag)) fail(page, `صورة بدون alt: ${tag.slice(0, 70)}`);
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) fail(page, `صورة بدون width/height (تسبب Layout Shift): ${tag.slice(0, 70)}`);
    if (!/fetchpriority="high"/.test(tag) && !/loading="lazy"/.test(tag)) fail(page, `صورة أسفل الصفحة بدون lazy: ${tag.slice(0, 70)}`);
  }

  // 6) h1 واحد في الصفحة الرئيسية
  if (page === 'index.html') {
    const h1 = (html.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) fail(page, `عدد h1 = ${h1} (المتوقع 1)`);

    // 7) عرض الإطلاق: السعر القديم مشطوب بوسم <del> فقط، ومعه نص «سعر إطلاق» و99 و199
    if (/<(s|strike)\b/.test(html)) fail(page, 'استخدم <del> للسعر المشطوب، لا <s> ولا <strike>');
    if (!/سعر إطلاق|سعر الإطلاق/.test(html)) fail(page, 'نص «سعر إطلاق» مفقود');
    if (!/<del[^>]*>[\s\S]*?199 ريال[\s\S]*?<\/del>/.test(html)) fail(page, 'السعر المشطوب «199 ريال» مفقود');
    if (!/<strong>99<\/strong> ريال سعودي فقط/.test(html)) fail(page, 'السعر «99 ريال سعودي فقط» مفقود');
    for (const t of ['منتج رقمي', 'الاستلام بعد الدفع مباشرة', 'ضمان استرجاع لمدة 14 يومًا']) {
      if (!html.includes(t)) fail(page, `الشارة مفقودة: "${t}"`);
    }
    if (!html.includes('ابدئي تجهيزاتك بـ99 ريال')) fail(page, 'نص زر الشراء الرئيسي «ابدئي تجهيزاتك بـ99 ريال» مفقود');
    const ctas = [...html.matchAll(/<a\b[^>]*\bdata-cta\b[^>]*>/g)].map((m) => m[0]);
    if (ctas.length < 5) fail(page, `عدد أزرار CTA = ${ctas.length} (المتوقع 5 على الأقل)`);

    // 8) عبارات غير معتمدة (وسائل دفع لم تُعتمد، وعود غير مطلوبة)
    for (const w of ['تخفيض', 'لفترة محدودة', 'استرداد', 'Apple Pay', 'مدى', 'Visa', 'Mastercard', 'stc pay', 'تسليم فوري', 'شحن مجاني']) {
      if (html.includes(w)) fail(page, `عبارة غير معتمدة: "${w}"`);
    }
    // 9) بطلب صاحب المشروع: لا رسائل عن مراحل التطوير/الاختبار ولا «تصوّر توضيحي» في الصفحة الرئيسية
    for (const w of ['قيد التجهيز', 'تصوّر توضيحي', 'تصورات توضيحية', 'لا يوجد دفع', 'مرحلة الاختبار']) {
      if (html.includes(w)) fail(page, `عبارة ممنوعة في الصفحة الرئيسية: "${w}"`);
    }

    if (siteMode === 'TEST_MODE') {
      for (const w of ['تم الشراء', 'شراء ناجح', 'شكرًا لشرائك', 'أضف إلى السلة']) {
        if (html.includes(w)) fail(page, `عبارة توحي بإتمام شراء في TEST_MODE: "${w}"`);
      }
      if (!/<meta name="robots" content="noindex/.test(html)) fail(page, 'noindex مفقود في TEST_MODE');
      const bad = ctas.filter((c) => !/href="\/prelaunch"/.test(c));
      if (bad.length) fail(page, `أزرار CTA لا تقود إلى /prelaunch في TEST_MODE: ${bad[0].slice(0, 80)}`);
      if (!existsSync(join(DIST, 'prelaunch.html'))) fail(page, 'prelaunch.html غير موجود');
    } else {
      const checkout = (html.match(/data-checkout-url="([^"]*)"/) || [])[1] || '';
      if (!/^https:\/\//.test(checkout)) fail(page, 'LIVE_MODE بلا رابط دفع https');
      const bad = ctas.filter((c) => !c.includes(`href="${checkout}"`));
      if (bad.length) fail(page, `أزرار CTA لا تقود لرابط الدفع في LIVE_MODE: ${bad[0].slice(0, 80)}`);
      if (/href="\/prelaunch"/.test(html)) fail(page, 'رابط /prelaunch ظاهر في LIVE_MODE');
      if (/<meta name="robots" content="noindex/.test(html)) fail(page, 'noindex ظاهر في LIVE_MODE');
    }
  }

  // 10) صفحة التسجيل قبل الإطلاق
  if (page === 'prelaunch.html') {
    if ((html.match(/<h1[\s>]/g) || []).length !== 1) fail(page, 'عدد h1 في prelaunch ليس 1');
    if (!/<meta name="robots" content="noindex/.test(html)) fail(page, 'noindex مفقود في prelaunch');
    if (siteMode === 'TEST_MODE') {
      for (const t of [
        'جاهزة ليومك قريبًا بين يديك!',
        'المنتج هيكون جاهز خلال 3 أيام. سجّلي طلبك الآن واحتفظي بسعر الإطلاق الخاص.',
        'سعر الإطلاق: <strong>99 ريال سعودي</strong>',
        'بدلًا من',
        '199 ريال',
        'لن يتم تحصيل أي مبلغ حاليًا',
        'سجّلي طلبي بسعر الإطلاق',
      ]) {
        if (!html.includes(t)) fail(page, `نص مطلوب مفقود: "${t}"`);
      }
      for (const id of ['lead-name', 'lead-email', 'lead-whatsapp', 'lead-consent', 'lead-submit']) {
        if (!seen.has(id)) fail(page, `حقل مفقود: #${id}`);
      }
      if (!/id="lead-name"[^>]*\brequired\b/.test(html) || !/id="lead-email"[^>]*\brequired\b/.test(html)) fail(page, 'الاسم والبريد يجب أن يكونا مطلوبين');
      if (/id="lead-whatsapp"[^>]*\brequired\b/.test(html)) fail(page, 'الواتساب يجب أن يكون اختياريًا');
      const noticeAt = html.indexOf('لن يتم تحصيل أي مبلغ حاليًا');
      const formAt = html.indexOf('<form');
      if (noticeAt < 0 || formAt < 0 || noticeAt > formAt) fail(page, 'عبارة «لن يتم تحصيل أي مبلغ» يجب أن تسبق النموذج');
      if (!html.includes('data-clarity-mask="True"')) fail(page, 'النموذج غير مقنّع في Clarity');
      for (const w of ['تم الشراء', 'شراء ناجح', 'أضف إلى السلة']) {
        if (html.includes(w)) fail(page, `عبارة توحي بإتمام شراء: "${w}"`);
      }
    } else if (!/<meta http-equiv="refresh" content="0; url=\/">/.test(html)) {
      fail(page, 'LIVE_MODE: prelaunch يجب أن يحوّل إلى الصفحة الرئيسية');
    }
  }
}

// 9) JS: لا استدعاء لـ Purchase من الواجهة
for (const f of ['assets/app.js', 'assets/tracker.js']) {
  const js = readFileSync(join(DIST, f), 'utf8');
  if (/track\(\s*['"]Purchase['"]/.test(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
      && f === 'assets/app.js') fail(f, 'استدعاء track("Purchase") من الواجهة');
  if (/fbq\(\s*['"]track['"]\s*,\s*['"]Purchase['"]/.test(js)) fail(f, 'fbq track Purchase من الواجهة');
}

// ملخص الحجم
const size = (rel) => (existsSync(join(DIST, rel)) ? statSync(join(DIST, rel)).size : 0);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`الوضع: ${siteMode}`);
console.log(`index.html ${kb(size('index.html'))} | app.css ${kb(size('assets/app.css'))} | tracker.js ${kb(size('assets/tracker.js'))} | app.js ${kb(size('assets/app.js'))}`);
console.log(`صورة الـ Hero (الأولى): hero-800.webp ${kb(size('images/hero-800.webp'))}`);

if (failures.length) {
  console.error(`\n❌ ${failures.length} مشكلة:`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log(`✅ اجتازت ${pages.length} صفحات جميع الفحوصات الثابتة.`);
