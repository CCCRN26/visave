// End-of-cycle mutations use one lock order everywhere: cycle first, meeting second.
// Reloading both rows after the locks prevents a request that waited behind share-out
// approval from continuing with a stale ACTIVE cycle status.
export async function lockContext(c,groupId,meetingId){
  const cycle=(await c.query(`SELECT cy.id FROM vsla_cycles cy JOIN vsla_meetings m ON m.cycle_id=cy.id WHERE m.id=$1 AND m.group_id=$2 AND cy.group_id=$2 FOR UPDATE OF cy`,[meetingId,groupId])).rows[0];
  if(!cycle)return null;
  return(await c.query(`SELECT m.*,g.status group_status,cy.status cycle_status,cy.constitution_id,cy.start_date,cy.expected_end_date,g.group_code,g.organization_id FROM vsla_cycles cy JOIN vsla_meetings m ON m.cycle_id=cy.id JOIN vsla_groups g ON g.id=cy.group_id WHERE cy.id=$1 AND m.id=$2 AND g.id=$3 FOR UPDATE OF m`,[cycle.id,meetingId,groupId])).rows[0]
}
export async function balances(c,cycleId){return(await c.query(`SELECT COALESCE(SUM(CASE WHEN a.account_code='SAVINGS_LOAN_CASH' THEN CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0)::numeric(18,2) savings_loan,COALESCE(SUM(CASE WHEN a.account_code='SOCIAL_FUND_CASH' THEN CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0)::numeric(18,2) social_fund FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id WHERE a.cycle_id=$1`,[cycleId])).rows[0]}
export async function accountMap(c,cycleId){return Object.fromEntries((await c.query('SELECT account_code,id FROM ledger_accounts WHERE cycle_id=$1',[cycleId])).rows.map(x=>[x.account_code,x.id]))}
export async function listMeetings(c,groupId){return(await c.query(`SELECT m.*,cy.cycle_number,concat(u.first_name,' ',u.last_name) opened_by_name,(SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=m.id) attendance_count,(SELECT COUNT(*)::int FROM meeting_attendance a WHERE a.meeting_id=m.id AND a.attendance_status IN ('PRESENT','LATE')) attended,(SELECT COALESCE(SUM(CASE transaction_kind WHEN 'PURCHASE' THEN amount ELSE -amount END),0)::numeric(18,2) FROM savings_transactions WHERE meeting_id=m.id) savings,(SELECT COALESCE(SUM(CASE transaction_kind WHEN 'CONTRIBUTION' THEN amount ELSE -amount END),0)::numeric(18,2) FROM social_fund_transactions WHERE meeting_id=m.id) social_fund,(SELECT COALESCE(SUM(CASE transaction_kind WHEN 'FINE' THEN amount ELSE -amount END),0)::numeric(18,2) FROM fine_transactions WHERE meeting_id=m.id) fines FROM vsla_meetings m JOIN vsla_cycles cy ON cy.id=m.cycle_id JOIN users u ON u.id=m.opened_by WHERE m.group_id=$1 ORDER BY m.meeting_number DESC`,[groupId])).rows}
export async function attendance(c,meetingId){return(await c.query(`SELECT a.*,m.member_code,concat(m.first_name,' ',m.last_name) member_name FROM meeting_attendance a JOIN group_members m ON m.id=a.member_id WHERE a.meeting_id=$1 ORDER BY m.member_number`,[meetingId])).rows}
export async function transactions(c,meetingId){return(await c.query(`SELECT t.*,concat(m.first_name,' ',m.last_name) member_name,COALESCE(s.amount,sf.amount,f.amount)::numeric(18,2) amount,s.shares,f.reason,fr.name fine_name,EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id) reversed FROM financial_transactions t LEFT JOIN group_members m ON m.id=t.member_id LEFT JOIN savings_transactions s ON s.financial_transaction_id=t.id LEFT JOIN social_fund_transactions sf ON sf.financial_transaction_id=t.id LEFT JOIN fine_transactions f ON f.financial_transaction_id=t.id LEFT JOIN constitution_fine_rules fr ON fr.id=f.fine_rule_id WHERE t.meeting_id=$1 ORDER BY t.created_at`,[meetingId])).rows}

export async function financialPosition(c, meetingId) {
  return (
    await c.query(
      `WITH target AS (
        SELECT id,cycle_id,meeting_number FROM vsla_meetings WHERE id=$1
      ), savings AS (
        SELECT
          COALESCE(SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.amount ELSE -s.amount END)
            FILTER (WHERE vm.meeting_number < t.meeting_number),0)::numeric(18,2) previous_amount,
          COALESCE(SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.amount ELSE -s.amount END)
            FILTER (WHERE s.meeting_id=t.id),0)::numeric(18,2) current_amount,
          COALESCE(SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.amount ELSE -s.amount END)
            FILTER (WHERE vm.meeting_number <= t.meeting_number),0)::numeric(18,2) total_amount
        FROM target t LEFT JOIN savings_transactions s ON s.cycle_id=t.cycle_id
        LEFT JOIN vsla_meetings vm ON vm.id=s.meeting_id
      ), social AS (
        SELECT
          COALESCE(SUM(CASE s.transaction_kind WHEN 'CONTRIBUTION' THEN s.amount ELSE -s.amount END)
            FILTER (WHERE s.meeting_id=t.id),0)::numeric(18,2) current_amount,
          COALESCE(SUM(CASE s.transaction_kind WHEN 'CONTRIBUTION' THEN s.amount ELSE -s.amount END)
            FILTER (WHERE vm.meeting_number <= t.meeting_number),0)::numeric(18,2) total_amount
        FROM target t LEFT JOIN social_fund_transactions s ON s.cycle_id=t.cycle_id
        LEFT JOIN vsla_meetings vm ON vm.id=s.meeting_id
      ), fines AS (
        SELECT COALESCE(SUM(CASE f.transaction_kind WHEN 'FINE' THEN f.amount ELSE -f.amount END)
          FILTER (WHERE f.meeting_id=t.id),0)::numeric(18,2) current_amount
        FROM target t LEFT JOIN fine_transactions f ON f.cycle_id=t.cycle_id
      ), ledger_activity AS (
        SELECT a.account_code,ft.transaction_type,ft.meeting_id,vm.meeting_number,
          COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) movement
        FROM target t JOIN ledger_accounts a ON a.cycle_id=t.cycle_id
        LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id
        LEFT JOIN financial_transactions ft ON ft.id=e.financial_transaction_id
        LEFT JOIN vsla_meetings vm ON vm.id=ft.meeting_id
        WHERE ft.id IS NULL OR vm.meeting_number<=t.meeting_number
        GROUP BY a.account_code,ft.transaction_type,ft.meeting_id,vm.meeting_number
      ), loans AS (
        SELECT
          COALESCE(SUM(movement) FILTER(WHERE account_code='LOANS_RECEIVABLE' AND transaction_type IN('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL') AND meeting_id=t.id),0)::numeric(18,2) disbursed_current,
          COALESCE(SUM(movement) FILTER(WHERE account_code='LOANS_RECEIVABLE' AND transaction_type IN('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL') AND la.meeting_number<t.meeting_number),0)::numeric(18,2) disbursed_previous,
          COALESCE(SUM(movement) FILTER(WHERE account_code='LOANS_RECEIVABLE' AND transaction_type IN('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL')),0)::numeric(18,2) disbursed_total,
          COALESCE(SUM(movement) FILTER(WHERE account_code='SAVINGS_LOAN_CASH' AND transaction_type IN('LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL') AND meeting_id=t.id),0)::numeric(18,2) repaid_current,
          COALESCE(SUM(movement) FILTER(WHERE account_code='SAVINGS_LOAN_CASH' AND transaction_type IN('LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL') AND la.meeting_number<t.meeting_number),0)::numeric(18,2) repaid_previous,
          COALESCE(SUM(movement) FILTER(WHERE account_code='SAVINGS_LOAN_CASH' AND transaction_type IN('LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL')),0)::numeric(18,2) repaid_total,
          COALESCE(SUM(movement) FILTER(WHERE account_code='LOANS_RECEIVABLE' AND la.meeting_number<t.meeting_number),0)::numeric(18,2) outstanding_before,
          COALESCE(SUM(movement) FILTER(WHERE account_code='LOANS_RECEIVABLE'),0)::numeric(18,2) outstanding_now,
          COALESCE(SUM(movement) FILTER(WHERE account_code='SOCIAL_FUND_CASH'),0)::numeric(18,2) social_balance
        FROM target t CROSS JOIN ledger_activity la
      )
      SELECT s.previous_amount previous_savings,s.current_amount current_savings,s.total_amount total_savings,
        sf.current_amount current_social_fund,sf.total_amount total_social_fund,f.current_amount current_fines,
        l.disbursed_previous previous_loan_disbursements,l.disbursed_current current_loan_disbursements,l.disbursed_total total_loan_disbursements,
        l.repaid_previous previous_loan_repayments,l.repaid_current current_loan_repayments,l.repaid_total total_loan_repayments,
        l.outstanding_before outstanding_principal_before,l.outstanding_now outstanding_principal_now,
        l.social_balance social_fund_balance
      FROM savings s CROSS JOIN social sf CROSS JOIN fines f CROSS JOIN loans l`,
      [meetingId],
    )
  ).rows[0];
}
