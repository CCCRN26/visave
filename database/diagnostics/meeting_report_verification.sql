-- Visave Meeting Report V2 verification.
-- Replace all three UUIDs, then run in pgAdmin.
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid group_id,
    '00000000-0000-0000-0000-000000000000'::uuid cycle_id,
    '00000000-0000-0000-0000-000000000000'::uuid meeting_id
), target AS (
  SELECT m.* FROM params p
  JOIN vsla_meetings m ON m.id=p.meeting_id AND m.group_id=p.group_id AND m.cycle_id=p.cycle_id
), latest_reconciliation AS (
  SELECT mr.status FROM params p
  JOIN meeting_reconciliations mr ON mr.meeting_id=p.meeting_id AND mr.group_id=p.group_id AND mr.cycle_id=p.cycle_id
  ORDER BY mr.created_at DESC,mr.id DESC LIMIT 1
)
SELECT
  t.meeting_number,t.meeting_date,t.status meeting_status,
  (SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=t.id AND a.group_id=t.group_id AND a.cycle_id=t.cycle_id) eligible_participants,
  (SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=t.id AND a.attendance_status='PRESENT') present,
  (SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=t.id AND a.attendance_status='ABSENT') absent,
  (SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=t.id AND a.attendance_status='LATE') late,
  (SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=t.id AND a.attendance_status='EXCUSED') excused,
  (SELECT COALESCE(SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.amount WHEN 'REVERSAL' THEN -s.amount ELSE 0 END),0)::numeric(18,2) FROM savings_transactions s WHERE s.meeting_id=t.id AND s.group_id=t.group_id AND s.cycle_id=t.cycle_id) net_savings,
  (SELECT COALESCE(SUM(CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN sf.amount WHEN 'REVERSAL' THEN -sf.amount ELSE 0 END),0)::numeric(18,2) FROM social_fund_transactions sf WHERE sf.meeting_id=t.id AND sf.group_id=t.group_id AND sf.cycle_id=t.cycle_id) social_fund_contributions,
  (SELECT COALESCE(SUM(CASE f.transaction_kind WHEN 'FINE' THEN f.amount WHEN 'REVERSAL' THEN -f.amount ELSE 0 END),0)::numeric(18,2) FROM fine_transactions f WHERE f.meeting_id=t.id AND f.group_id=t.group_id AND f.cycle_id=t.cycle_id) fines_collected,
  (SELECT COALESCE(SUM(l.principal_disbursed),0)::numeric(18,2) FROM loans l WHERE l.disbursement_meeting_id=t.id AND l.group_id=t.group_id AND l.cycle_id=t.cycle_id) loans_disbursed,
  (SELECT COALESCE(SUM(CASE r.transaction_kind WHEN 'PAYMENT' THEN r.payment_amount WHEN 'REVERSAL' THEN -r.payment_amount ELSE 0 END),0)::numeric(18,2) FROM loan_repayments r WHERE r.meeting_id=t.id AND r.group_id=t.group_id AND r.cycle_id=t.cycle_id) loan_repayments,
  (SELECT COALESCE(SUM(CASE r.transaction_kind WHEN 'PAYMENT' THEN r.service_charge_component WHEN 'REVERSAL' THEN -r.service_charge_component ELSE 0 END),0)::numeric(18,2) FROM loan_repayments r WHERE r.meeting_id=t.id AND r.group_id=t.group_id AND r.cycle_id=t.cycle_id) service_charge_collected,
  COALESCE((SELECT status FROM latest_reconciliation),'NOT YET RECONCILED') reconciliation_status
FROM target t;
