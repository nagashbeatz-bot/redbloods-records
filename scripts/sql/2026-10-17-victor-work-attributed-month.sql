-- Owner-approved 2026-10-17: Victor work month attribution ("העבר לחודש אחר"). Applied in production 2026-10-17 (no backfill).
ALTER TABLE public.vendor_project_work
  ADD COLUMN attributed_month text NULL
  CHECK (attributed_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Rollback:
-- ALTER TABLE public.vendor_project_work DROP COLUMN attributed_month;
