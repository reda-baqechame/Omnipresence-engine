-- Per-project HMAC secret for the public tracking beacon (/api/track).
-- When set, beacons must include x-tracking-signature: sha256=<hmac(body)>.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tracking_hmac TEXT;

UPDATE public.projects
SET tracking_hmac = encode(gen_random_bytes(32), 'hex')
WHERE tracking_hmac IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN tracking_hmac SET NOT NULL,
  ALTER COLUMN tracking_hmac SET DEFAULT encode(gen_random_bytes(32), 'hex');
