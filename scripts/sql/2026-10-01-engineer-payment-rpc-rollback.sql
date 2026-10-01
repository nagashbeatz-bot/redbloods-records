-- Rollback of 2026-10-01-engineer-payment-rpc.sql (no data to restore: the function writes nothing by itself).
-- NOTE: roll back the CODE first (the app calls this function); otherwise a payment write fails with "function not found".
DROP INDEX IF EXISTS public.sound_engineer_work_linked_tx_uk;
DROP FUNCTION IF EXISTS public.apply_engineer_payment(uuid,text,text,text,text,boolean,numeric,date,text,text,text,text,numeric,text,text,text,date,boolean,text,text);
NOTIFY pgrst, 'reload schema';
