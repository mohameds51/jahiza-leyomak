-- جدول تسجيل الاهتمام (Neon PostgreSQL).
-- شغّله يدويًا مرة واحدة من Neon SQL Editor قبل تفعيل LEAD_CAPTURE=on.
-- لا يُنفَّذ تلقائيًا من الكود.

CREATE TABLE IF NOT EXISTS leads (
  id           bigserial   PRIMARY KEY,
  email        text        NOT NULL UNIQUE,
  consent_at   timestamptz NOT NULL DEFAULT now(),
  utm_source   text,
  utm_campaign text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
