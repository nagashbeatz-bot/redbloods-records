-- apply_engineer_payment — ONE atomic write of an engineer work's payment + its linked mix Finance expense.
-- Owner-approved 2026-10-01 (Stage 0: 31 / 31 PASS in a rolled-back transaction, rollback verified by md5).
-- Narrow by design: typed parameters only (no jsonb), fixed type 'expense' + category 'מיקס / מאסטר', INSERT / UPDATE only.
-- Rollback: scripts/sql/2026-10-01-engineer-payment-rpc-rollback.sql

CREATE OR REPLACE FUNCTION public.apply_engineer_payment(
  p_work_id uuid, p_expected_updated_at text, p_expected_linked text, p_action text, p_tx_id text,
  p_touch_payment boolean, p_amount_paid numeric, p_payment_date date,
  p_project_id text, p_scope text, p_description text, p_artist text,
  p_amount numeric, p_currency text, p_payment_status text, p_notes text, p_date date, p_set_date boolean,
  p_business_unit text, p_business_unit_source text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  w public.sound_engineer_work%ROWTYPE;
  v_tx uuid;
  n integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_action NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'BAD_ACTION'; END IF;
  IF p_payment_status NOT IN ('שולם','חלקי','לא שולם') THEN RAISE EXCEPTION 'BAD_STATUS'; END IF;
  IF p_scope NOT IN ('project','general') THEN RAISE EXCEPTION 'BAD_SCOPE'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_currency IS NULL OR btrim(p_currency) = '' THEN RAISE EXCEPTION 'BAD_AMOUNT'; END IF;
  IF p_payment_status = 'שולם' AND (p_date IS NULL OR NOT COALESCE(p_set_date, false)) THEN RAISE EXCEPTION 'PAID_NEEDS_DATE'; END IF;
  IF COALESCE(p_touch_payment, false) AND (p_amount_paid IS NULL OR p_amount_paid < 0) THEN RAISE EXCEPTION 'BAD_PAID'; END IF;

  SELECT * INTO w FROM public.sound_engineer_work WHERE id = p_work_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_NOT_FOUND'; END IF;
  IF p_expected_updated_at IS NOT NULL AND w.updated_at IS DISTINCT FROM p_expected_updated_at::timestamptz THEN
    RAISE EXCEPTION 'STALE_WORK';
  END IF;
  IF COALESCE(w.linked_transaction_id, '') <> COALESCE(p_expected_linked, '') THEN RAISE EXCEPTION 'STALE_LINK'; END IF;

  IF p_action = 'UPDATE' THEN
    IF COALESCE(p_tx_id, '') = '' OR p_tx_id <> w.linked_transaction_id THEN RAISE EXCEPTION 'STALE_LINK'; END IF;
    v_tx := p_tx_id::uuid;
    UPDATE public.transactions t SET
      project_id = p_project_id, scope = p_scope, description = p_description, artist = p_artist,
      amount = p_amount, currency = p_currency, payment_status = p_payment_status, notes = p_notes,
      date = CASE WHEN COALESCE(p_set_date, false) THEN p_date ELSE t.date END
    WHERE t.id = v_tx AND t.type = 'expense' AND t.category = 'מיקס / מאסטר' AND t.payment_status <> 'שולם';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'TX_NOT_UPDATABLE'; END IF;
  ELSE
    IF COALESCE(w.linked_transaction_id, '') <> ''
       AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id::text = w.linked_transaction_id) THEN
      RAISE EXCEPTION 'STALE_LINK';
    END IF;
    INSERT INTO public.transactions
      (project_id, scope, type, category, description, artist, amount, currency, payment_status,
       payment_method, receipt_ref, notes, date, linked_session_id, business_unit, business_unit_source)
    VALUES
      (p_project_id, p_scope, 'expense', 'מיקס / מאסטר', p_description, p_artist, p_amount, p_currency, p_payment_status,
       '', '', p_notes, CASE WHEN COALESCE(p_set_date, false) THEN p_date ELSE NULL END, '', p_business_unit, p_business_unit_source)
    RETURNING id INTO v_tx;
  END IF;

  UPDATE public.sound_engineer_work SET
    linked_transaction_id = v_tx::text,
    amount_paid  = CASE WHEN COALESCE(p_touch_payment, false) THEN p_amount_paid  ELSE amount_paid  END,
    payment_date = CASE WHEN COALESCE(p_touch_payment, false) THEN p_payment_date ELSE payment_date END,
    updated_at   = CASE WHEN COALESCE(p_touch_payment, false) THEN v_now          ELSE updated_at   END
  WHERE id = p_work_id;

  RETURN jsonb_build_object('txId', v_tx::text, 'action', p_action,
    'updatedAt', (SELECT updated_at::text FROM public.sound_engineer_work WHERE id = p_work_id));
END $$;

REVOKE ALL ON FUNCTION public.apply_engineer_payment(uuid,text,text,text,text,boolean,numeric,date,text,text,text,text,numeric,text,text,text,date,boolean,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_engineer_payment(uuid,text,text,text,text,boolean,numeric,date,text,text,text,text,numeric,text,text,text,date,boolean,text,text) TO service_role;

-- No two works may point at the same Finance expense (verified 2026-10-01: 0 duplicates today).
CREATE UNIQUE INDEX IF NOT EXISTS sound_engineer_work_linked_tx_uk
  ON public.sound_engineer_work (linked_transaction_id)
  WHERE linked_transaction_id IS NOT NULL AND linked_transaction_id <> '';

NOTIFY pgrst, 'reload schema';
