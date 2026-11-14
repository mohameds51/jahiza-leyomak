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

    // 7) لا سعر مشطوب ولا خصم
    if (/<(del|s|strike)\b/.test(html)) fail(page, 'عنصر شطب (سعر مشطوب)');
    for (const w of ['خصم', 'تخفيض', 'لفترة محدودة', 'ضمان استرجاع', 'استرداد', 'Apple Pay', 'مدى', 'Visa', 'Mastercard', 'stc pay', 'تسليم فوري', 'شحن مجاني']) {
      if (html.includes(w)) fail(page, `عبارة غير معتمدة: "${w}"`);
    }
    // 8) عبارات ممنوعة في TEST_MODE
    if (siteMode === 'TEST_MODE') {
      for (const w of ['تم الشراء', 'شراء ناجح', 'شكرًا لشرائك', 'اشتري الآن', 'أضف إلى السلة']) {
        if (html.includes(w)) fail(page, `عبارة توحي بالشراء في TEST_MODE: "${w}"`);
      }
      if (!html.includes('قيد التجهيز')) fail(page, 'لا توجد رسالة «قيد التجهيز» في TEST_MODE');
      if (!/<meta name="robots" content="noindex/.test(html)) fail(page, 'noindex مفقود في TEST_MODE');
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
