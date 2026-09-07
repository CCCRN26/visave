export async function financialState(client, groupId, cycleId, meetingId) {
  return (await client.query(`WITH accounts AS (
    SELECT account_code,COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0) balance
    FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id WHERE a.cycle_id=$2 GROUP BY account_code
  ), savings AS (
    SELECT COALESCE(SUM(CASE transaction_kind WHEN 'PURCHASE' THEN shares ELSE -shares END),0)::bigint shares,
           COALESCE(SUM(CASE transaction_kind WHEN 'PURCHASE' THEN amount ELSE -amount END),0)::numeric(18,2) amount FROM savings_transactions WHERE cycle_id=$2
  ), repayments AS (
    SELECT loan_id,COALESCE(SUM(CASE transaction_kind WHEN 'PAYMENT' THEN principal_component ELSE -principal_component END),0) principal,
      COALESCE(SUM(CASE transaction_kind WHEN 'PAYMENT' THEN service_charge_component ELSE -service_charge_component END),0) charge FROM loan_repayments WHERE cycle_id=$2 GROUP BY loan_id
  ) SELECT m.id meeting_id,g.status group_status,c.status cycle_status,m.status meeting_status,s.shares total_shares,s.amount total_savings,
    COALESCE((SELECT balance FROM accounts WHERE account_code='SAVINGS_LOAN_CASH'),0)::numeric(18,2) savings_cash,
    COALESCE((SELECT balance FROM accounts WHERE account_code='SOCIAL_FUND_CASH'),0)::numeric(18,2) social_cash,
    (-COALESCE((SELECT balance FROM accounts WHERE account_code='MEMBER_SAVINGS_CONTROL'),0))::numeric(18,2) savings_control,
    (-COALESCE((SELECT balance FROM accounts WHERE account_code='FINE_INCOME'),0))::numeric(18,2) fine_income,
    (-COALESCE((SELECT balance FROM accounts WHERE account_code='LOAN_SERVICE_CHARGE_INCOME'),0))::numeric(18,2) charge_income,
    (COALESCE((SELECT balance FROM accounts WHERE account_code='SAVINGS_LOAN_CASH'),0)
      - s.amount
      + COALESCE((SELECT balance FROM accounts WHERE account_code='FINE_INCOME'),0)
      + COALESCE((SELECT balance FROM accounts WHERE account_code='LOAN_SERVICE_CHARGE_INCOME'),0))::numeric(18,2) distributable_discrepancy,
    COALESCE((SELECT balance FROM accounts WHERE account_code='LOANS_RECEIVABLE'),0)::numeric(18,2) receivable,
    COALESCE((SELECT balance FROM accounts WHERE account_code='SHAREOUT_PAYABLE'),0)::numeric(18,2) shareout_payable,
    (SELECT COUNT(*)::int FROM vsla_meetings x WHERE x.cycle_id=c.id AND x.status='OPEN' AND x.id<>m.id) other_open,
    (SELECT COUNT(*)::int FROM vsla_meetings x WHERE x.cycle_id=c.id AND x.meeting_number<m.meeting_number AND x.status NOT IN('CLOSED','CANCELLED')) prior_unresolved,
    (SELECT COUNT(*)::int FROM vsla_meetings x WHERE x.cycle_id=c.id AND x.meeting_number>m.meeting_number AND x.status<>'CANCELLED') later_valid_meetings,
    (SELECT COUNT(*)::int FROM savings_transactions x WHERE x.cycle_id=c.id AND x.amount<>(x.shares*x.share_value)::numeric(18,2)) invalid_savings_rows,
    (SELECT COUNT(*)::int FROM cycle_memberships x WHERE x.cycle_id=c.id) included_members,
    (SELECT COUNT(*)::int FROM loan_requests r WHERE r.cycle_id=c.id AND r.status IN('PENDING','APPROVED')) unresolved_requests,
    (SELECT COUNT(*)::int FROM loans l LEFT JOIN repayments p ON p.loan_id=l.id WHERE l.cycle_id=c.id AND l.voided_at IS NULL AND ((l.principal_disbursed-COALESCE(p.principal,0))<>0 OR (l.service_charge_total_due-COALESCE(p.charge,0))<>0)) outstanding_loans,
    (SELECT COUNT(*)::int FROM (SELECT t.id FROM financial_transactions t LEFT JOIN ledger_entries e ON e.financial_transaction_id=t.id WHERE t.cycle_id=c.id GROUP BY t.id HAVING COALESCE(SUM(e.amount) FILTER(WHERE e.entry_side='DEBIT'),0)<>COALESCE(SUM(e.amount) FILTER(WHERE e.entry_side='CREDIT'),0)) x) unbalanced
  FROM vsla_groups g JOIN vsla_cycles c ON c.group_id=g.id JOIN vsla_meetings m ON m.cycle_id=c.id CROSS JOIN savings s WHERE g.id=$1 AND c.id=$2 AND m.id=$3`, [groupId, cycleId, meetingId])).rows[0];
}

export async function entitlementRows(client, cycleId, fund) {
  return (await client.query(`WITH member_savings AS (
    SELECT m.id,m.member_code,m.status member_status,concat_ws(' ',m.first_name,m.middle_name,m.last_name) member_name,
      COALESCE(SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.shares ELSE -s.shares END),0)::bigint net_shares,
      COALESCE(SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.amount ELSE -s.amount END),0)::numeric(18,2) net_savings
    FROM cycle_memberships cm JOIN group_members m ON m.id=cm.member_id AND m.group_id=cm.group_id LEFT JOIN savings_transactions s ON s.member_id=m.id AND s.cycle_id=cm.cycle_id WHERE cm.cycle_id=$1 GROUP BY m.id
  ), raw AS (SELECT *,CASE WHEN net_shares>0 THEN ($2::numeric*net_shares/SUM(net_shares) OVER()) ELSE 0 END raw_amount FROM member_savings),
  floored AS (SELECT *,trunc(raw_amount,2) base_amount,raw_amount-trunc(raw_amount,2) remainder FROM raw),
  ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,member_code,id) remainder_rank,round(($2::numeric-SUM(base_amount) OVER())*100)::bigint residual_cents FROM floored)
  SELECT *,base_amount::numeric(18,2),CASE WHEN remainder_rank<=residual_cents THEN 0.01 ELSE 0 END::numeric(18,2) adjustment,
    (base_amount+CASE WHEN remainder_rank<=residual_cents THEN 0.01 ELSE 0 END)::numeric(18,2) final_amount FROM ranked ORDER BY member_code`, [cycleId, fund])).rows;
}
