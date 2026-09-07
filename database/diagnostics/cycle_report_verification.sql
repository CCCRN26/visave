-- Visave Cycle Report V1 reconciliation.
-- Replace the two UUID values below, then run the complete statement in pgAdmin.
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS group_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS cycle_id
), latest_shareout AS (
  SELECT s.* FROM cycle_shareouts s,params p
  WHERE s.group_id=p.group_id AND s.cycle_id=p.cycle_id
  ORDER BY s.version_number DESC LIMIT 1
), loan_activity AS (
  SELECT
    COALESCE(SUM(CASE ft.transaction_type WHEN 'LOAN_DISBURSEMENT' THEN l.principal_disbursed WHEN 'LOAN_DISBURSEMENT_REVERSAL' THEN -l.principal_disbursed ELSE 0 END),0)::numeric(18,2) disbursed
  FROM params p
  JOIN financial_transactions ft ON ft.group_id=p.group_id AND ft.cycle_id=p.cycle_id
    AND ft.transaction_type IN('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL')
  JOIN loans l ON l.disbursement_financial_transaction_id=COALESCE(ft.reversal_of_transaction_id,ft.id)
), repayment_activity AS (
  SELECT
    COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.payment_amount WHEN 'REVERSAL' THEN -rp.payment_amount ELSE 0 END),0)::numeric(18,2) repaid,
    COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.service_charge_component WHEN 'REVERSAL' THEN -rp.service_charge_component ELSE 0 END),0)::numeric(18,2) service_charge_collected
  FROM params p LEFT JOIN loan_repayments rp ON rp.group_id=p.group_id AND rp.cycle_id=p.cycle_id
), shareout_totals AS (
  SELECT
    COALESCE(SUM(e.final_entitlement),0)::numeric(18,2) entitlements,
    COALESCE(SUM(paid.net_paid),0)::numeric(18,2) paid
  FROM latest_shareout s
  LEFT JOIN cycle_shareout_entitlements e ON e.shareout_id=s.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(CASE sp.transaction_kind WHEN 'PAYOUT' THEN sp.amount WHEN 'REVERSAL' THEN -sp.amount ELSE 0 END),0)::numeric(18,2) net_paid
    FROM shareout_payouts sp WHERE sp.entitlement_id=e.id
  ) paid ON true
)
SELECT
  cy.cycle_number,cy.status cycle_status,
  (SELECT COUNT(*)::int FROM cycle_memberships cm WHERE cm.group_id=p.group_id AND cm.cycle_id=p.cycle_id) participant_count,
  (SELECT COUNT(*)::int FROM vsla_meetings m WHERE m.group_id=p.group_id AND m.cycle_id=p.cycle_id AND m.status<>'CANCELLED') meeting_count,
  (SELECT COALESCE(SUM(CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount WHEN 'REVERSAL' THEN -st.amount ELSE 0 END),0)::numeric(18,2) FROM savings_transactions st WHERE st.group_id=p.group_id AND st.cycle_id=p.cycle_id) net_savings,
  (SELECT COALESCE(SUM(CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN sf.amount WHEN 'REVERSAL' THEN -sf.amount ELSE 0 END),0)::numeric(18,2) FROM social_fund_transactions sf WHERE sf.group_id=p.group_id AND sf.cycle_id=p.cycle_id) social_fund_member_contributions,
  (SELECT COALESCE(SUM(CASE le.entry_side WHEN 'DEBIT' THEN le.amount WHEN 'CREDIT' THEN -le.amount ELSE 0 END),0)::numeric(18,2) FROM ledger_accounts la LEFT JOIN ledger_entries le ON le.ledger_account_id=la.id WHERE la.group_id=p.group_id AND la.cycle_id=p.cycle_id AND la.account_code='SOCIAL_FUND_CASH') social_fund_balance,
  (SELECT COALESCE(SUM(CASE f.transaction_kind WHEN 'FINE' THEN f.amount WHEN 'REVERSAL' THEN -f.amount ELSE 0 END),0)::numeric(18,2) FROM fine_transactions f WHERE f.group_id=p.group_id AND f.cycle_id=p.cycle_id) fines_collected,
  (SELECT disbursed FROM loan_activity) loans_disbursed,
  (SELECT repaid FROM repayment_activity) loan_repayments,
  (SELECT service_charge_collected FROM repayment_activity) loan_service_charge_collected,
  (SELECT COALESCE(SUM(CASE le.entry_side WHEN 'DEBIT' THEN le.amount WHEN 'CREDIT' THEN -le.amount ELSE 0 END),0)::numeric(18,2) FROM ledger_accounts la LEFT JOIN ledger_entries le ON le.ledger_account_id=la.id WHERE la.group_id=p.group_id AND la.cycle_id=p.cycle_id AND la.account_code='LOANS_RECEIVABLE') outstanding_loans,
  COALESCE((SELECT distributable_fund FROM latest_shareout),0)::numeric(18,2) shareout_distributable_fund,
  COALESCE((SELECT entitlements FROM shareout_totals),0)::numeric(18,2) shareout_entitlements,
  COALESCE((SELECT paid FROM shareout_totals),0)::numeric(18,2) shareout_paid
FROM params p
JOIN vsla_cycles cy ON cy.id=p.cycle_id AND cy.group_id=p.group_id;

-- Savings by selected cycle meeting. Reversals are explicit and cancelled meetings are excluded.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid group_id,'00000000-0000-0000-0000-000000000000'::uuid cycle_id
)
SELECT m.meeting_number,m.meeting_date,
  COALESCE(SUM(CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount WHEN 'REVERSAL' THEN -st.amount ELSE 0 END),0)::numeric(18,2) net_savings
FROM params p JOIN vsla_meetings m ON m.group_id=p.group_id AND m.cycle_id=p.cycle_id AND m.status<>'CANCELLED'
LEFT JOIN savings_transactions st ON st.meeting_id=m.id
GROUP BY m.id ORDER BY m.meeting_number;

-- Social Fund contributions and carry-in/out remain separate.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid group_id,'00000000-0000-0000-0000-000000000000'::uuid cycle_id
)
SELECT
  (SELECT COALESCE(SUM(CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN sf.amount WHEN 'REVERSAL' THEN -sf.amount ELSE 0 END),0)::numeric(18,2) FROM social_fund_transactions sf WHERE sf.group_id=p.group_id AND sf.cycle_id=p.cycle_id) member_contributions,
  (SELECT COALESCE(SUM(t.amount),0)::numeric(18,2) FROM cycle_social_fund_transfers t WHERE t.group_id=p.group_id AND t.target_cycle_id=p.cycle_id) opening_carry_in,
  (SELECT COALESCE(SUM(t.amount),0)::numeric(18,2) FROM cycle_social_fund_transfers t WHERE t.group_id=p.group_id AND t.source_cycle_id=p.cycle_id) carried_forward
FROM params p;
