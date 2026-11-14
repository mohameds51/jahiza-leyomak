// POST /api/lead — تسجيل الطلب قبل الإطلاق (يُستخدم في TEST_MODE فقط).
//
// يعمل فقط إذا كان:  LEAD_CAPTURE=on  و  DATABASE_URL موجودًا في بيئة الخادم.
// غير ذلك يرد بـ 503 ولا يتصل بأي قاعدة بيانات.
// الأسرار (DATABASE_URL) تُقرأ هنا فقط في الخادم ولا تصل أبدًا إلى الواجهة.
//
// الحقول: first_name (مطلوب) · email (مطلوب) · whatsapp (اختياري) · consent (يجب أن يكون true)
//         · utm_source / utm_campaign (اختياريان) · company (حقل فخ للروبوتات، يجب أن يكون فارغًا)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function defaultGetSql(env) {
  // استيراد ديناميكي: لا يُحمَّل ولا يتصل بشيء إلا عند وصول طلب صالح.
  const { neon } = await import('@neondatabase/serverless');
  return neon(env.DATABASE_URL);
}

function clean(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().slice(0, 100);
  return v || null;
}

// الاسم الأول: نص من 1 إلى 60 حرفًا، بلا رموز تحكم ولا < >.
function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v || v.length > 60 || /[\u0000-\u001f\u007f<>]/.test(v)) return null;
  return v;
}

// الواتساب اختياري. يقبل الأرقام العربية الهندية (٠-٩) ويزيل المسافات والشرطات والأقواس،
// ثم يشترط 8–15 رقمًا مع + اختيارية في البداية. يعيد { ok, value }.
function normalizePhone(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  let v = value.trim();
  if (!v) return { ok: true, value: null };
  v = v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s\-().]/g, '');
  return /^\+?\d{8,15}$/.test(v) ? { ok: true, value: v } : { ok: false };
}

function originAllowed(req, env) {
  const origin = req.headers.origin;
  if (!origin) return true; // طلبات بدون Origin (أدوات اختبار/نفس الأصل في بعض المتصفحات)
  const host = req.headers.host || '';
  const allowed = new Set();
  if (host) allowed.add(`https://${host}`);
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) allowed.add(`http://${host}`);
  if (env.SITE_URL) allowed.add(env.SITE_URL.replace(/\/+$/, ''));
  return allowed.has(origin);
}

export function createHandler({ getSql = defaultGetSql, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    if (String(env.LEAD_CAPTURE || 'off').toLowerCase() !== 'on' || !env.DATABASE_URL) {
      return res.status(503).json({ ok: false, error: 'not_configured' });
    }

    if (!originAllowed(req, env)) {
      return res.status(403).json({ ok: false, error: 'forbidden_origin' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ ok: false, error: 'invalid_body' });
    }

    // حقل فخ للروبوتات (honeypot): الزائرة الحقيقية لا تراه ولا تملؤه.
    if (typeof body.company === 'string' && body.company.trim() !== '') {
      return res.status(400).json({ ok: false, error: 'invalid_body' });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    const firstName = normalizeName(body.first_name);
    if (!firstName) {
      return res.status(400).json({ ok: false, error: 'invalid_name' });
    }
    const whatsapp = normalizePhone(body.whatsapp);
    if (!whatsapp.ok) {
      return res.status(400).json({ ok: false, error: 'invalid_whatsapp' });
    }
    if (body.consent !== true) {
      return res.status(400).json({ ok: false, error: 'consent_required' });
    }

    try {
      const sql = await getSql(env);
      // ON CONFLICT DO NOTHING: لا نكشف إن كان البريد مسجلًا من قبل، ولا نسمح بتعديل بيانات تسجيل سابق ببريد غيرك.
      await sql`
        INSERT INTO leads (email, first_name, whatsapp, consent_at, utm_source, utm_campaign)
        VALUES (${email}, ${firstName}, ${whatsapp.value}, now(), ${clean(body.utm_source)}, ${clean(body.utm_campaign)})
        ON CONFLICT (email) DO NOTHING
      `;
      return res.status(200).json({ ok: true });
    } catch (err) {
      // لا نطبع البيانات الشخصية ولا تفاصيل الاتصال في السجلات.
      console.error('lead_insert_failed', err && (err.code || err.name));
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
}

export default createHandler();
