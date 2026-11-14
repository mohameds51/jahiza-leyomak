// POST /api/lead — تسجيل اهتمام اختياري (يُستخدم في TEST_MODE فقط).
//
// يعمل فقط إذا كان:  LEAD_CAPTURE=on  و  DATABASE_URL موجودًا في بيئة الخادم.
// غير ذلك يرد بـ 503 ولا يتصل بأي قاعدة بيانات.
// الأسرار (DATABASE_URL) تُقرأ هنا فقط في الخادم ولا تصل أبدًا إلى الواجهة.

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
    if (body.consent !== true) {
      return res.status(400).json({ ok: false, error: 'consent_required' });
    }

    try {
      const sql = await getSql(env);
      // ON CONFLICT: لا نكشف إن كان البريد مسجلًا من قبل، ونرد بنجاح في الحالتين.
      await sql`
        INSERT INTO leads (email, consent_at, utm_source, utm_campaign)
        VALUES (${email}, now(), ${clean(body.utm_source)}, ${clean(body.utm_campaign)})
        ON CONFLICT (email) DO NOTHING
      `;
      return res.status(200).json({ ok: true });
    } catch (err) {
      // لا نطبع البريد ولا تفاصيل الاتصال في السجلات.
      console.error('lead_insert_failed', err && (err.code || err.name));
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
}

export default createHandler();
