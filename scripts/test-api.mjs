// اختبار مباشر لدالة api/lead.js بقاعدة بيانات محاكاة (بدون شبكة وبدون أي حزم).
// الاستخدام: npm run test:api
// ملاحظة: يتأكد من منطق الدالة فقط. الاتصال الفعلي بـ Neon يحتاج اختبارًا منفصلًا بعد ضبط DATABASE_URL.
import { createHandler } from '../api/lead.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== '' ? `  [${extra}]` : ''));
};

function mkRes() {
  const r = { code: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  return r;
}

function mkSql(calls, { throwErr } = {}) {
  return async () => async (strings, ...vals) => {
    if (throwErr) { const e = new Error('boom user@secret.com'); e.code = 'XX000'; throw e; }
    calls.push({ text: strings.join('?'), vals });
    return [];
  };
}

const baseEnv = { LEAD_CAPTURE: 'on', DATABASE_URL: 'postgres://x', SITE_URL: 'https://site.test' };
const good = { first_name: '  سارة  ', email: '  Sara@Example.COM ', consent: true, company: '' };

async function call(env, req) {
  const calls = [];
  const res = mkRes();
  const h = createHandler({ getSql: mkSql(calls, req._sql || {}), env });
  await h({ method: 'POST', headers: { host: 'site.test' }, body: good, ...req }, res);
  return { res, calls };
}

// الطريقة
let r = await call(baseEnv, { method: 'GET' });
ok('GET → 405 مع Allow: POST', r.res.code === 405 && r.res.headers['allow'] === 'POST');
ok('الردود Cache-Control: no-store', r.res.headers['cache-control'] === 'no-store');

// الإعداد
r = await call({ ...baseEnv, LEAD_CAPTURE: 'off' }, {});
ok('LEAD_CAPTURE=off → 503 بدون استدعاء لقاعدة البيانات', r.res.code === 503 && r.calls.length === 0);
r = await call({ ...baseEnv, DATABASE_URL: '' }, {});
ok('بدون DATABASE_URL → 503 بدون استدعاء', r.res.code === 503 && r.calls.length === 0);
r = await call({ SITE_URL: '' }, {});
ok('بدون أي إعداد (الافتراضي) → 503', r.res.code === 503 && r.calls.length === 0);

// الأصل (Origin)
r = await call(baseEnv, { headers: { host: 'site.test', origin: 'https://evil.test' } });
ok('Origin غريب → 403', r.res.code === 403 && r.calls.length === 0);
r = await call(baseEnv, { headers: { host: 'site.test', origin: 'https://site.test' } });
ok('Origin = نفس الموقع → 200', r.res.code === 200);
r = await call(baseEnv, { headers: { host: 'x.vercel.app', origin: 'https://site.test' } });
ok('Origin = SITE_URL المضبوط → 200', r.res.code === 200);
r = await call(baseEnv, { headers: { host: 'localhost:4173', origin: 'http://localhost:4173' } });
ok('localhost مسموح للتطوير', r.res.code === 200);

// الجسم
r = await call(baseEnv, { body: '{bad json' });
ok('JSON فاسد → 400', r.res.code === 400 && r.calls.length === 0);
r = await call(baseEnv, { body: JSON.stringify(good) });
ok('جسم نصي JSON صالح يُقبل', r.res.code === 200);
r = await call(baseEnv, { body: undefined });
ok('بدون جسم → 400', r.res.code === 400);
r = await call(baseEnv, { body: { ...good, company: 'bot' } });
ok('honeypot معبّأ → 400 ولا إدخال', r.res.code === 400 && r.calls.length === 0);

// البريد
for (const [label, email] of [
  ['فارغ', ''], ['بدون @', 'abc'], ['بدون نطاق', 'a@b'], ['مسافة داخلية', 'a b@c.com'],
  ['رقم', 123], ['أطول من 254', 'a'.repeat(250) + '@b.com'],
]) {
  r = await call(baseEnv, { body: { ...good, email } });
  ok(`بريد غير صالح (${label}) → 400`, r.res.code === 400 && r.calls.length === 0, r.res.body && r.res.body.error);
}

// الاسم الأول (مطلوب)
for (const [label, first_name] of [
  ['غير موجود', undefined], ['فارغ', ''], ['مسافات فقط', '   '], ['رقم', 5],
  ['أطول من 60', 'س'.repeat(61)], ['يحوي <', 'سا<رة'], ['يحوي رمز تحكم', 'سا\u0000رة'],
]) {
  r = await call(baseEnv, { body: { ...good, first_name } });
  ok(`اسم غير صالح (${label}) → 400 invalid_name`, r.res.code === 400 && r.res.body.error === 'invalid_name' && r.calls.length === 0, r.res.body && r.res.body.error);
}

// الواتساب (اختياري)
for (const [label, whatsapp, expected] of [
  ['غير موجود', undefined, null],
  ['فارغ', '', null],
  ['مسافات فقط', '   ', null],
  ['سعودي محلي', '0551234567', '0551234567'],
  ['دولي بمسافات وشرطات', '+966 55-123-4567', '+966551234567'],
  ['أرقام عربية هندية', '٠٥٥ ١٢٣ ٤٥٦٧', '0551234567'],
  ['بأقواس ونقاط', '(055) 123.4567', '0551234567'],
]) {
  r = await call(baseEnv, { body: { ...good, whatsapp } });
  ok(`واتساب ${label} → يُقبل ويُحفظ كـ ${JSON.stringify(expected)}`, r.res.code === 200 && r.calls[0].vals[2] === expected, r.calls[0] && r.calls[0].vals[2]);
}
for (const [label, whatsapp] of [['حروف', 'abc12345678'], ['قصير', '12345'], ['طويل', '1'.repeat(16)], ['رقم JSON', 551234567], ['+ في الوسط', '055+1234567']]) {
  r = await call(baseEnv, { body: { ...good, whatsapp } });
  ok(`واتساب غير صالح (${label}) → 400 invalid_whatsapp`, r.res.code === 400 && r.res.body.error === 'invalid_whatsapp' && r.calls.length === 0, r.res.body && r.res.body.error);
}

// الموافقة
for (const consent of [false, 'true', 1, undefined]) {
  r = await call(baseEnv, { body: { ...good, consent } });
  ok(`consent=${JSON.stringify(consent)} → 400`, r.res.code === 400 && r.calls.length === 0);
}

// النجاح
r = await call(baseEnv, { body: { ...good, whatsapp: '0551234567', utm_source: ' meta ', utm_campaign: 'c'.repeat(300), extra: 'x' } });
ok('نجاح → 200 { ok: true }', r.res.code === 200 && r.res.body.ok === true);
ok('إدخال واحد فقط', r.calls.length === 1);
ok('البريد يُنظَّف ويُحوَّل لحروف صغيرة', r.calls[0].vals[0] === 'sara@example.com', r.calls[0].vals[0]);
ok('الاسم يُقصّ من المسافات', r.calls[0].vals[1] === 'سارة', r.calls[0].vals[1]);
ok('الواتساب في المعامل الثالث', r.calls[0].vals[2] === '0551234567');
ok('utm_source يُقصّ، وutm_campaign ≤ 100 حرف', r.calls[0].vals[3] === 'meta' && r.calls[0].vals[4].length === 100);
ok('الاستعلام معلَّم (parameterized): لا بيانات شخصية داخل نص SQL',
  !r.calls[0].text.includes('sara@') && !r.calls[0].text.includes('سارة') && !r.calls[0].text.includes('0551234567') &&
  r.calls[0].text.includes('ON CONFLICT (email) DO NOTHING'));
r = await call(baseEnv, { body: { first_name: "Ann'; DROP TABLE leads;--", email: "o'brien@ex.com", consent: true } });
ok('اقتباس وSQL في الاسم/البريد تمر كمعاملات ولا تكسر الاستعلام',
  r.res.code === 200 && r.calls[0].vals[1].includes('DROP TABLE') && !r.calls[0].text.includes('DROP') && !r.calls[0].text.includes("o'brien"));

// الفشل
const logged = [];
const origErr = console.error;
console.error = (...a) => logged.push(a.join(' '));
r = await call(baseEnv, { _sql: { throwErr: true } });
console.error = origErr;
ok('فشل قاعدة البيانات → 500 برمز خطأ عام',
  r.res.code === 500 && r.res.body.error === 'server_error' && !JSON.stringify(r.res.body).includes('boom'));
ok('سجل الخادم لا يحتوي بيانات شخصية ولا نص الاستثناء',
  logged.length === 1 && !logged[0].includes('@') && !logged[0].includes('boom') && !logged[0].includes('سارة'), logged[0]);

console.log(`\napi: ${pass}/${pass + fail} نجحت`);
process.exit(fail ? 1 : 0);
