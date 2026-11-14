-- جدول التسجيل قبل الإطلاق (Neon PostgreSQL).
-- شغّله يدويًا مرة واحدة من Neon SQL Editor قبل تفعيل LEAD_CAPTURE=on.
-- لا يُنفَّذ تلقائيًا من الكود. آمن للتشغيل أكثر من مرة.

CREATE TABLE IF NOT EXISTS leads (
  id           bigserial   PRIMARY KEY,
  email        text        NOT NULL UNIQUE,
  first_name   text,
  whatsapp     text,
  consent_at   timestamptz NOT NULL DEFAULT now(),
  utm_source   text,
  utm_campaign text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- إن كنت أنشأت الجدول سابقًا بالنسخة القديمة (بريد فقط)، هذان السطران يضيفان الحقلين الجديدين:
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp   text;
