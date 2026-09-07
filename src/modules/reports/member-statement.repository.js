const rows = async (client, sql, params) => (await client.query(sql, params)).rows;

export async function statementMetadata(client, organizationId, groupId, cycleId, memberId) {
  return (await rows(client, `
    SELECT g.id group_id,g.group_code,g.name group_name,g.operation_mode,
      s.name state_name,l.name lga_name,COALESCE(NULLIF(TRIM(g.community_name),''),co.name) community_name,
      cy.id cycle_id,cy.cycle_number,cy.status cycle_status,
      gm.id member_id,gm.linked_user_id,gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name,
      cm.participation_start_date::text,cm.participation_end_date::text
    FROM cycle_memberships cm
    JOIN group_members gm ON gm.id=cm.member_id AND gm.group_id=cm.group_id
    JOIN vsla_cycles cy ON cy.id=cm.cycle_id AND cy.group_id=cm.group_id
    JOIN vsla_groups g ON g.id=cy.group_id AND g.organization_id=$1
    LEFT JOIN states s ON s.id=g.state_id LEFT JOIN lgas l ON l.id=g.lga_id LEFT JOIN communities co ON co.id=g.community_id
    WHERE g.id=$2 AND cy.id=$3 AND gm.id=$4 AND cm.group_id=$2 AND cm.cycle_id=$3
      AND cy.status IN('ACTIVE','CLOSING','CLOSED')`, [organizationId, groupId, cycleId, memberId]))[0] || null;
}

export function attendance(client, groupId, cycleId, memberId) {
  return rows(client, `
    SELECT vm.id meeting_id,vm.meeting_number,vm.meeting_date::text,vm.status meeting_status,
      ma.attendance_status,ma.notes,ma.recorded_at,concat_ws(' ',u.first_name,u.last_name) recorded_by_name
    FROM cycle_memberships cm
    JOIN vsla_meetings vm ON vm.group_id=cm.group_id AND vm.cycle_id=cm.cycle_id AND vm.status<>'CANCELLED'
      AND cm.participation_start_date<=vm.meeting_date AND (cm.participation_end_date IS NULL OR cm.participation_end_date>=vm.meeting_date)
    LEFT JOIN meeting_attendance ma ON ma.group_id=vm.group_id AND ma.cycle_id=vm.cycle_id AND ma.meeting_id=vm.id AND ma.member_id=cm.member_id
    LEFT JOIN users u ON u.id=ma.recorded_by
    WHERE cm.group_id=$1 AND cm.cycle_id=$2 AND cm.member_id=$3 ORDER BY vm.meeting_number`, [groupId, cycleId, memberId]);
}

export function savingsTransactions(client, groupId, cycleId, memberId) {
  return rows(client, `SELECT st.*,ft.reference_code,ft.effective_date::text,vm.meeting_number,vm.meeting_date::text
    FROM savings_transactions st JOIN financial_transactions ft ON ft.id=st.financial_transaction_id
    LEFT JOIN vsla_meetings vm ON vm.id=st.meeting_id AND vm.group_id=st.group_id AND vm.cycle_id=st.cycle_id
    WHERE st.group_id=$1 AND st.cycle_id=$2 AND st.member_id=$3 AND (vm.id IS NULL OR vm.status<>'CANCELLED') ORDER BY ft.effective_date,ft.created_at,st.id`, [groupId, cycleId, memberId]);
}

export function socialFundTransactions(client, groupId, cycleId, memberId) {
  return rows(client, `SELECT sf.*,ft.reference_code,ft.effective_date::text,vm.meeting_number,vm.meeting_date::text
    FROM social_fund_transactions sf JOIN financial_transactions ft ON ft.id=sf.financial_transaction_id
    LEFT JOIN vsla_meetings vm ON vm.id=sf.meeting_id AND vm.group_id=sf.group_id AND vm.cycle_id=sf.cycle_id
    WHERE sf.group_id=$1 AND sf.cycle_id=$2 AND sf.member_id=$3 AND (vm.id IS NULL OR vm.status<>'CANCELLED') ORDER BY ft.effective_date,ft.created_at,sf.id`, [groupId, cycleId, memberId]);
}

export function fineTransactions(client, groupId, cycleId, memberId) {
  return rows(client, `SELECT f.*,fr.name fine_name,ft.reference_code,ft.effective_date::text,vm.meeting_number
    FROM fine_transactions f JOIN financial_transactions ft ON ft.id=f.financial_transaction_id
    LEFT JOIN constitution_fine_rules fr ON fr.id=f.fine_rule_id LEFT JOIN vsla_meetings vm ON vm.id=f.meeting_id
    WHERE f.group_id=$1 AND f.cycle_id=$2 AND f.member_id=$3 AND (vm.id IS NULL OR vm.status<>'CANCELLED') ORDER BY ft.effective_date,ft.created_at,f.id`, [groupId, cycleId, memberId]);
}

export function loans(client, groupId, cycleId, memberId) {
  return rows(client, `SELECT l.id,l.loan_code,l.member_id,gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,
    lr.purpose,lr.requested_at,lr.requested_principal,ld.approved_principal,l.disbursement_date::text,l.principal_disbursed,l.service_charge_total_due,l.due_date::text,l.settled_at,l.voided_at,l.defaulted_at,
    COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.payment_amount WHEN 'REVERSAL' THEN -rp.payment_amount ELSE 0 END),0)::numeric(18,2) total_repaid,
    COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.principal_component WHEN 'REVERSAL' THEN -rp.principal_component ELSE 0 END),0)::numeric(18,2) principal_repaid,
    COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.service_charge_component WHEN 'REVERSAL' THEN -rp.service_charge_component ELSE 0 END),0)::numeric(18,2) service_charge_collected,
    CASE WHEN l.voided_at IS NOT NULL THEN 'VOIDED' WHEN l.settled_at IS NOT NULL THEN 'REPAID' WHEN l.defaulted_at IS NOT NULL THEN 'DEFAULTED' WHEN (CASE WHEN cy.status='CLOSED' THEN cy.closed_at::date ELSE CURRENT_DATE END)>l.due_date THEN 'OVERDUE' WHEN COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.payment_amount WHEN 'REVERSAL' THEN -rp.payment_amount ELSE 0 END),0)>0 THEN 'PARTIALLY_REPAID' ELSE 'ACTIVE' END status
    FROM loans l JOIN vsla_cycles cy ON cy.id=l.cycle_id JOIN group_members gm ON gm.id=l.member_id AND gm.group_id=l.group_id JOIN loan_requests lr ON lr.id=l.loan_request_id JOIN loan_decisions ld ON ld.id=l.loan_decision_id LEFT JOIN loan_repayments rp ON rp.loan_id=l.id
    WHERE l.group_id=$1 AND l.cycle_id=$2 AND l.member_id=$3 GROUP BY l.id,cy.id,gm.id,lr.id,ld.id ORDER BY l.disbursement_date,l.loan_code`, [groupId, cycleId, memberId]);
}

export function loanTransactions(client, groupId, cycleId, memberId) {
  return rows(client, `SELECT ft.id,ft.reference_code,ft.transaction_type,ft.effective_date::text,ft.created_at,ft.reversal_of_transaction_id,(ft.reversal_of_transaction_id IS NOT NULL) is_reversal,vm.meeting_number,l.id loan_id,l.loan_code,gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,COALESCE(rp.payment_amount,l.principal_disbursed)::numeric(18,2) amount,COALESCE(rp.principal_component,l.principal_disbursed)::numeric(18,2) principal_component,COALESCE(rp.service_charge_component,0)::numeric(18,2) service_charge_component
    FROM financial_transactions ft LEFT JOIN vsla_meetings vm ON vm.id=ft.meeting_id LEFT JOIN loan_repayments rp ON rp.financial_transaction_id=ft.id LEFT JOIN loans l ON l.id=rp.loan_id OR l.disbursement_financial_transaction_id=COALESCE(ft.reversal_of_transaction_id,ft.id) LEFT JOIN group_members gm ON gm.id=COALESCE(l.member_id,ft.member_id)
    WHERE ft.group_id=$1 AND ft.cycle_id=$2 AND ft.member_id=$3 AND ft.transaction_type IN('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL','LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL') AND (vm.id IS NULL OR vm.status<>'CANCELLED') ORDER BY ft.effective_date,ft.created_at,ft.id`, [groupId, cycleId, memberId]);
}
