const rows = async (client, sql, params) => (await client.query(sql, params)).rows;

export function listCycles(client, organizationId, groupId) {
  return rows(client, `
    SELECT cy.id,cy.cycle_number,cy.status,cy.start_date::text,cy.expected_end_date::text,
      cy.expected_shareout_date::text,cy.closed_at
    FROM vsla_cycles cy
    JOIN vsla_groups g ON g.id=cy.group_id
    WHERE cy.group_id=$1 AND g.organization_id=$2 AND cy.status IN('ACTIVE','CLOSING','CLOSED')
    ORDER BY cy.cycle_number DESC`, [groupId, organizationId]);
}

export async function cycleMetadata(client, organizationId, groupId, cycleId) {
  return (await rows(client, `
    SELECT g.id group_id,g.group_code,g.name group_name,g.operation_mode,
      s.name state_name,l.name lga_name,COALESCE(NULLIF(TRIM(g.community_name),''),c.name) community_name,
      cy.id cycle_id,cy.cycle_number,cy.status cycle_status,cy.start_date::text,
      cy.expected_end_date::text,cy.expected_shareout_date::text,cy.closed_at,
      concat_ws(' ',creator.first_name,creator.last_name) cycle_created_by_name,
      concat_ws(' ',closer.first_name,closer.last_name) cycle_closed_by_name
    FROM vsla_cycles cy
    JOIN vsla_groups g ON g.id=cy.group_id AND g.organization_id=$1
    LEFT JOIN states s ON s.id=g.state_id
    LEFT JOIN lgas l ON l.id=g.lga_id
    LEFT JOIN communities c ON c.id=g.community_id
    LEFT JOIN users creator ON creator.id=cy.created_by
    LEFT JOIN users closer ON closer.id=cy.closed_by
    WHERE g.id=$2 AND cy.id=$3 AND cy.status IN('ACTIVE','CLOSING','CLOSED')`,
    [organizationId, groupId, cycleId]))[0] || null;
}

export function participants(client, groupId, cycleId) {
  return rows(client, `
    SELECT cm.member_id,m.member_code,concat_ws(' ',m.first_name,m.middle_name,m.last_name) member_name,
      m.member_number,m.status member_status,cm.participation_start_date::text,cm.participation_end_date::text
    FROM cycle_memberships cm
    JOIN group_members m ON m.id=cm.member_id AND m.group_id=cm.group_id
    WHERE cm.group_id=$1 AND cm.cycle_id=$2
    ORDER BY m.member_number,m.member_code`, [groupId, cycleId]);
}

export function officers(client, groupId, cycleId) {
  return rows(client, `
    SELECT oa.member_id,oa.position_code,oa.status,oa.appointed_at::text,oa.ended_at::text,
      m.member_code,concat_ws(' ',m.first_name,m.middle_name,m.last_name) member_name
    FROM group_officer_assignments oa
    JOIN group_members m ON m.id=oa.member_id AND m.group_id=oa.group_id
    WHERE oa.group_id=$1 AND oa.cycle_id=$2
    ORDER BY oa.position_code,oa.created_at`, [groupId, cycleId]);
}

export function meetings(client, groupId, cycleId) {
  return rows(client, `
    SELECT m.id,m.meeting_number,m.meeting_code,m.meeting_date::text,m.status,m.closed_at,
      concat_ws(' ',u.first_name,u.last_name) opened_by_name
    FROM vsla_meetings m
    JOIN users u ON u.id=m.opened_by
    WHERE m.group_id=$1 AND m.cycle_id=$2 AND m.status<>'CANCELLED'
    ORDER BY m.meeting_number`, [groupId, cycleId]);
}

export function attendance(client, groupId, cycleId) {
  return rows(client, `
    SELECT a.meeting_id,a.member_id,a.attendance_status,a.recorded_at
    FROM meeting_attendance a
    JOIN vsla_meetings m ON m.id=a.meeting_id AND m.group_id=a.group_id AND m.cycle_id=a.cycle_id
    WHERE a.group_id=$1 AND a.cycle_id=$2 AND m.status<>'CANCELLED'
    ORDER BY m.meeting_number,a.member_id`, [groupId, cycleId]);
}

export function savingsTransactions(client, groupId, cycleId) {
  return rows(client, `
    SELECT st.id,st.financial_transaction_id,st.meeting_id,st.member_id,st.transaction_kind,
      st.shares,st.share_value,st.amount,st.original_savings_transaction_id,ft.reference_code,ft.effective_date::text,ft.created_at
    FROM savings_transactions st
    JOIN financial_transactions ft ON ft.id=st.financial_transaction_id
    JOIN vsla_meetings m ON m.id=st.meeting_id AND m.status<>'CANCELLED'
    WHERE st.group_id=$1 AND st.cycle_id=$2
    ORDER BY ft.created_at,st.id`, [groupId, cycleId]);
}

export function socialFundTransactions(client, groupId, cycleId) {
  return rows(client, `
    SELECT sf.id,sf.financial_transaction_id,sf.meeting_id,sf.member_id,sf.transaction_kind,
      sf.amount,sf.original_social_fund_transaction_id,ft.reference_code,ft.effective_date::text,ft.created_at
    FROM social_fund_transactions sf
    JOIN financial_transactions ft ON ft.id=sf.financial_transaction_id
    JOIN vsla_meetings m ON m.id=sf.meeting_id AND m.status<>'CANCELLED'
    WHERE sf.group_id=$1 AND sf.cycle_id=$2
    ORDER BY ft.created_at,sf.id`, [groupId, cycleId]);
}

export function fineTransactions(client, groupId, cycleId) {
  return rows(client, `
    SELECT f.id,f.financial_transaction_id,f.meeting_id,f.member_id,f.fine_rule_id,f.transaction_kind,
      f.amount,f.reason,f.original_fine_transaction_id,fr.name fine_name,
      ft.reference_code,ft.effective_date::text,ft.created_at,
      m.meeting_number,gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name
    FROM fine_transactions f
    JOIN financial_transactions ft ON ft.id=f.financial_transaction_id
    JOIN vsla_meetings m ON m.id=f.meeting_id AND m.status<>'CANCELLED'
    JOIN group_members gm ON gm.id=f.member_id AND gm.group_id=f.group_id
    LEFT JOIN constitution_fine_rules fr ON fr.id=f.fine_rule_id
    WHERE f.group_id=$1 AND f.cycle_id=$2
    ORDER BY ft.created_at,f.id`, [groupId, cycleId]);
}

export function loans(client, groupId, cycleId) {
  return rows(client, `
    SELECT l.id,l.loan_code,l.member_id,gm.member_code,
      concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,
      lr.purpose,lr.requested_at,lr.requested_principal,ld.approved_principal,
      l.disbursement_date::text,l.principal_disbursed,l.service_charge_rate,l.service_charge_total_due,
      l.total_contractual_due,l.due_date::text,l.settled_at,l.voided_at,l.defaulted_at,
      COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.payment_amount WHEN 'REVERSAL' THEN -rp.payment_amount ELSE 0 END),0)::numeric(18,2) total_repaid,
      COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.principal_component WHEN 'REVERSAL' THEN -rp.principal_component ELSE 0 END),0)::numeric(18,2) principal_repaid,
      COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.service_charge_component WHEN 'REVERSAL' THEN -rp.service_charge_component ELSE 0 END),0)::numeric(18,2) service_charge_collected,
      CASE WHEN l.voided_at IS NOT NULL THEN 'VOIDED' WHEN l.settled_at IS NOT NULL THEN 'REPAID'
        WHEN l.defaulted_at IS NOT NULL THEN 'DEFAULTED'
        WHEN (CASE WHEN cy.status='CLOSED' THEN cy.closed_at::date ELSE CURRENT_DATE END)>l.due_date THEN 'OVERDUE'
        WHEN COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.payment_amount WHEN 'REVERSAL' THEN -rp.payment_amount ELSE 0 END),0)>0 THEN 'PARTIALLY_REPAID'
        ELSE 'ACTIVE' END status
    FROM loans l
    JOIN vsla_cycles cy ON cy.id=l.cycle_id
    JOIN group_members gm ON gm.id=l.member_id AND gm.group_id=l.group_id
    JOIN loan_requests lr ON lr.id=l.loan_request_id
    JOIN loan_decisions ld ON ld.id=l.loan_decision_id
    LEFT JOIN loan_repayments rp ON rp.loan_id=l.id
    WHERE l.group_id=$1 AND l.cycle_id=$2
    GROUP BY l.id,cy.id,gm.id,lr.id,ld.id
    ORDER BY l.disbursement_date,l.loan_code`, [groupId, cycleId]);
}

export function loanTransactions(client, groupId, cycleId) {
  return rows(client, `
    SELECT ft.id,ft.reference_code,ft.transaction_type,ft.effective_date::text,ft.created_at,
      ft.reversal_of_transaction_id,(ft.reversal_of_transaction_id IS NOT NULL) is_reversal,
      vm.meeting_number,l.id loan_id,l.loan_code,gm.member_code,
      concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,
      COALESCE(rp.payment_amount,l.principal_disbursed)::numeric(18,2) amount,
      COALESCE(rp.principal_component,l.principal_disbursed)::numeric(18,2) principal_component,
      COALESCE(rp.service_charge_component,0)::numeric(18,2) service_charge_component
    FROM financial_transactions ft
    LEFT JOIN vsla_meetings vm ON vm.id=ft.meeting_id
    LEFT JOIN loan_repayments rp ON rp.financial_transaction_id=ft.id
    LEFT JOIN loans l ON l.id=rp.loan_id OR l.disbursement_financial_transaction_id=COALESCE(ft.reversal_of_transaction_id,ft.id)
    LEFT JOIN group_members gm ON gm.id=COALESCE(l.member_id,ft.member_id)
    WHERE ft.group_id=$1 AND ft.cycle_id=$2
      AND ft.transaction_type IN('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL','LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL')
      AND (vm.id IS NULL OR vm.status<>'CANCELLED')
    ORDER BY ft.effective_date,ft.created_at,ft.id`, [groupId, cycleId]);
}

export function cashbook(client, groupId, cycleId) {
  return rows(client, `
    SELECT le.id,ft.effective_date::text,ft.created_at,vm.meeting_number,ft.reference_code,
      ft.transaction_type,la.account_code,la.account_name,la.fund_type,le.entry_side,le.amount
    FROM ledger_entries le
    JOIN financial_transactions ft ON ft.id=le.financial_transaction_id
    JOIN ledger_accounts la ON la.id=le.ledger_account_id
    LEFT JOIN vsla_meetings vm ON vm.id=ft.meeting_id
    WHERE ft.group_id=$1 AND ft.cycle_id=$2 AND la.cycle_id=$2
      AND (vm.id IS NULL OR vm.status<>'CANCELLED')
    ORDER BY ft.effective_date,ft.created_at,ft.id,le.id`, [groupId, cycleId]);
}

export function accountBalances(client, groupId, cycleId) {
  return rows(client, `
    SELECT la.account_code,la.account_name,la.fund_type,
      COALESCE(SUM(CASE le.entry_side WHEN 'DEBIT' THEN le.amount WHEN 'CREDIT' THEN -le.amount ELSE 0 END),0)::numeric(18,2) balance
    FROM ledger_accounts la
    LEFT JOIN ledger_entries le ON le.ledger_account_id=la.id
    WHERE la.group_id=$1 AND la.cycle_id=$2
    GROUP BY la.id
    ORDER BY la.fund_type,la.account_code`, [groupId, cycleId]);
}

export function socialFundTransfers(client, groupId, cycleId) {
  return rows(client, `
    SELECT t.id,t.source_cycle_id,t.target_cycle_id,t.amount,t.created_at,
      source.cycle_number source_cycle_number,target.cycle_number target_cycle_number,
      CASE WHEN t.target_cycle_id=$2 THEN 'CARRY_IN' ELSE 'CARRY_OUT' END direction
    FROM cycle_social_fund_transfers t
    JOIN vsla_cycles source ON source.id=t.source_cycle_id
    JOIN vsla_cycles target ON target.id=t.target_cycle_id
    WHERE t.group_id=$1 AND (t.source_cycle_id=$2 OR t.target_cycle_id=$2)
    ORDER BY t.created_at,t.id`, [groupId, cycleId]);
}

export function reconciliations(client, groupId, cycleId) {
  return rows(client, `
    SELECT DISTINCT ON (mr.meeting_id) mr.id,mr.meeting_id,mr.status,
      mr.expected_savings_loan_balance,mr.counted_savings_loan_balance,mr.savings_loan_difference,
      mr.expected_social_fund_balance,mr.counted_social_fund_balance,mr.social_fund_difference,
      mr.created_at,concat_ws(' ',u.first_name,u.last_name) created_by_name,
      EXISTS(SELECT 1 FROM reconciliation_signatures rs WHERE rs.reconciliation_id=mr.id) signature_recorded
    FROM meeting_reconciliations mr
    JOIN vsla_meetings vm ON vm.id=mr.meeting_id AND vm.status<>'CANCELLED'
    JOIN users u ON u.id=mr.created_by
    WHERE mr.group_id=$1 AND mr.cycle_id=$2
    ORDER BY mr.meeting_id,mr.created_at DESC,mr.id DESC`, [groupId, cycleId]);
}

export async function nextCycle(client, groupId, cycleNumber) {
  return (await rows(client, `
    SELECT id,cycle_number,status,start_date::text,expected_end_date::text
    FROM vsla_cycles WHERE group_id=$1 AND cycle_number=$2`, [groupId, Number(cycleNumber) + 1]))[0] || null;
}
