-- RLS for the refund ledger (money-out). Facility-scoped, staff-only, same pattern as receipt/voucher.
-- Pattern: app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))

ALTER TABLE "refund_record" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_record_isolation ON "refund_record";
CREATE POLICY refund_record_isolation ON "refund_record"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
