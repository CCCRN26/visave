const rows = async (client, sql, params) => (await client.query(sql, params)).rows;

export async function meetingMetadata(client, organizationId, groupId, cycleId, meetingId) {
  return (await rows(client, `
    SELECT g.id group_id,g.group_code,g.name group_name,g.operation_mode,
      s.name state_name,l.name lga_name,COALESCE(NULLIF(TRIM(g.community_name),''),c.name) community_name,
      cy.id cycle_id,cy.cycle_number,cy.status cycle_status,
      m.id meeting_id,m.meeting_number,m.meeting_code,m.meeting_date::text,m.status meeting_status,
      m.opened_at,m.closed_at,m.cancelled_at,m.cancellation_reason,
      concat_ws(' ',opener.first_name,opener.last_name) opened_by_name,
      concat_ws(' ',closer.first_name,closer.last_name) closed_by_name,
      concat_ws(' ',canceller.first_name,canceller.last_name) cancelled_by_name
    FROM vsla_meetings m
    JOIN vsla_cycles cy ON cy.id=m.cycle_id AND cy.group_id=m.group_id
    JOIN vsla_groups g ON g.id=cy.group_id AND g.organization_id=$1
    LEFT JOIN states s ON s.id=g.state_id
    LEFT JOIN lgas l ON l.id=g.lga_id
    LEFT JOIN communities c ON c.id=g.community_id
    JOIN users opener ON opener.id=m.opened_by
    LEFT JOIN users closer ON closer.id=m.closed_by
    LEFT JOIN users canceller ON canceller.id=m.cancelled_by
    WHERE g.id=$2 AND cy.id=$3 AND m.id=$4
      AND m.group_id=$2 AND m.cycle_id=$3
      AND cy.status IN('ACTIVE','CLOSING','CLOSED')`,
    [organizationId, groupId, cycleId, meetingId]))[0] || null;
}

export function meetingParticipants(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT ma.member_id,gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name,
      gm.member_number,gm.status member_status,cm.participation_start_date::text,cm.participation_end_date::text,
      ma.attendance_status,ma.notes attendance_notes,ma.recorded_at,
      concat_ws(' ',recorder.first_name,recorder.last_name) recorded_by_name
    FROM meeting_attendance ma
    JOIN vsla_meetings vm ON vm.id=ma.meeting_id AND vm.group_id=ma.group_id AND vm.cycle_id=ma.cycle_id
    JOIN cycle_memberships cm ON cm.group_id=ma.group_id AND cm.cycle_id=ma.cycle_id AND cm.member_id=ma.member_id
      AND cm.participation_start_date<=vm.meeting_date
      AND (cm.participation_end_date IS NULL OR cm.participation_end_date>=vm.meeting_date)
    JOIN group_members gm ON gm.id=ma.member_id AND gm.group_id=ma.group_id
    LEFT JOIN users recorder ON recorder.id=ma.recorded_by
    WHERE ma.group_id=$1 AND ma.cycle_id=$2 AND ma.meeting_id=$3
    ORDER BY gm.member_number,gm.member_code`, [groupId, cycleId, meetingId]);
}

export function meetingSavings(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT st.id,st.financial_transaction_id,st.meeting_id,st.member_id,st.transaction_kind,
      st.shares,st.share_value,st.amount,st.original_savings_transaction_id,
      ft.reference_code,ft.effective_date::text,ft.created_at,
      gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name
    FROM savings_transactions st
    JOIN financial_transactions ft ON ft.id=st.financial_transaction_id
      AND ft.group_id=st.group_id AND ft.cycle_id=st.cycle_id AND ft.meeting_id=st.meeting_id
    JOIN group_members gm ON gm.id=st.member_id AND gm.group_id=st.group_id
    WHERE st.group_id=$1 AND st.cycle_id=$2 AND st.meeting_id=$3
    ORDER BY gm.member_number,ft.created_at,st.id`, [groupId, cycleId, meetingId]);
}

export function meetingSocialFund(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT sf.id,sf.financial_transaction_id,sf.meeting_id,sf.member_id,sf.transaction_kind,
      sf.amount,sf.original_social_fund_transaction_id,ft.reference_code,ft.effective_date::text,ft.created_at,
      gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name
    FROM social_fund_transactions sf
    JOIN financial_transactions ft ON ft.id=sf.financial_transaction_id
      AND ft.group_id=sf.group_id AND ft.cycle_id=sf.cycle_id AND ft.meeting_id=sf.meeting_id
    JOIN group_members gm ON gm.id=sf.member_id AND gm.group_id=sf.group_id
    WHERE sf.group_id=$1 AND sf.cycle_id=$2 AND sf.meeting_id=$3
    ORDER BY gm.member_number,ft.created_at,sf.id`, [groupId, cycleId, meetingId]);
}

export function meetingFines(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT f.id,f.financial_transaction_id,f.meeting_id,f.member_id,f.fine_rule_id,f.transaction_kind,
      f.amount,f.reason,f.original_fine_transaction_id,fr.name fine_name,
      ft.reference_code,ft.effective_date::text,ft.created_at,
      vm.meeting_number,gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name
    FROM fine_transactions f
    JOIN financial_transactions ft ON ft.id=f.financial_transaction_id
      AND ft.group_id=f.group_id AND ft.cycle_id=f.cycle_id AND ft.meeting_id=f.meeting_id
    JOIN vsla_meetings vm ON vm.id=f.meeting_id AND vm.group_id=f.group_id AND vm.cycle_id=f.cycle_id
    JOIN group_members gm ON gm.id=f.member_id AND gm.group_id=f.group_id
    LEFT JOIN constitution_fine_rules fr ON fr.id=f.fine_rule_id
    WHERE f.group_id=$1 AND f.cycle_id=$2 AND f.meeting_id=$3
    ORDER BY ft.created_at,f.id`, [groupId, cycleId, meetingId]);
}

export function meetingLoanRequests(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT lr.id,lr.request_code,lr.member_id,gm.member_code,
      concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,
      lr.purpose,lr.requested_principal,lr.requested_term_months,lr.requested_at,lr.request_meeting_id,
      concat_ws(' ',requester.first_name,requester.last_name) requested_by_name,
      d.decision,d.approved_principal,d.approved_term_months,d.decision_meeting_id,d.decided_at,
      concat_ws(' ',decider.first_name,decider.last_name) decided_by_name,
      lr.cancelled_at,concat_ws(' ',canceller.first_name,canceller.last_name) cancelled_by_name,
      l.disbursement_meeting_id,
      CASE
        WHEN l.disbursement_meeting_id=$3 THEN 'DISBURSED'
        WHEN d.decision_meeting_id=$3 THEN d.decision
        WHEN lr.request_meeting_id=$3 AND lr.cancelled_at IS NOT NULL
          AND (vm.status='OPEN' OR lr.cancelled_at<=COALESCE(vm.closed_at,vm.cancelled_at)) THEN 'CANCELLED'
        ELSE 'PENDING'
      END report_status
    FROM loan_requests lr
    JOIN group_members gm ON gm.id=lr.member_id AND gm.group_id=lr.group_id
    JOIN users requester ON requester.id=lr.requested_by
    JOIN vsla_meetings vm ON vm.id=$3 AND vm.group_id=lr.group_id AND vm.cycle_id=lr.cycle_id
    LEFT JOIN loan_decisions d ON d.loan_request_id=lr.id
    LEFT JOIN users decider ON decider.id=d.decided_by
    LEFT JOIN users canceller ON canceller.id=lr.cancelled_by
    LEFT JOIN loans l ON l.loan_request_id=lr.id
    WHERE lr.group_id=$1 AND lr.cycle_id=$2
      AND (lr.request_meeting_id=$3 OR d.decision_meeting_id=$3 OR l.disbursement_meeting_id=$3)
    ORDER BY lr.requested_at,lr.id`, [groupId, cycleId, meetingId]);
}

export function meetingLoans(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT l.id,l.loan_code,l.member_id,gm.member_code,
      concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,
      lr.purpose,l.principal_disbursed,l.service_charge_rate,l.term_months,
      l.service_charge_total_due,l.total_contractual_due,l.disbursement_date::text,l.due_date::text,
      concat_ws(' ',disburser.first_name,disburser.last_name) disbursed_by_name,
      CASE WHEN EXISTS(
        SELECT 1 FROM financial_transactions reversal
        WHERE reversal.reversal_of_transaction_id=l.disbursement_financial_transaction_id
          AND reversal.meeting_id=$3 AND reversal.transaction_type='LOAN_DISBURSEMENT_REVERSAL'
      ) THEN 'VOIDED' ELSE 'ACTIVE' END status_at_meeting
    FROM loans l
    JOIN group_members gm ON gm.id=l.member_id AND gm.group_id=l.group_id
    JOIN loan_requests lr ON lr.id=l.loan_request_id
    JOIN users disburser ON disburser.id=l.created_by
    WHERE l.group_id=$1 AND l.cycle_id=$2 AND l.disbursement_meeting_id=$3
    ORDER BY l.created_at,l.id`, [groupId, cycleId, meetingId]);
}

export function meetingRepayments(client, groupId, cycleId, meetingId) {
  return rows(client, `
    SELECT rp.id,rp.financial_transaction_id,rp.transaction_kind,rp.payment_amount,
      rp.principal_component,rp.service_charge_component,rp.original_loan_repayment_id,rp.created_at,
      ft.reference_code,ft.effective_date::text,l.id loan_id,l.loan_code,
      gm.member_code,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) borrower_name,
      concat_ws(' ',recorder.first_name,recorder.last_name) recorded_by_name
    FROM loan_repayments rp
    JOIN financial_transactions ft ON ft.id=rp.financial_transaction_id
      AND ft.group_id=rp.group_id AND ft.cycle_id=rp.cycle_id AND ft.meeting_id=rp.meeting_id
    JOIN loans l ON l.id=rp.loan_id AND l.group_id=rp.group_id AND l.cycle_id=rp.cycle_id
    JOIN group_members gm ON gm.id=rp.member_id AND gm.group_id=rp.group_id
    JOIN users recorder ON recorder.id=rp.created_by
    WHERE rp.group_id=$1 AND rp.cycle_id=$2 AND rp.meeting_id=$3
    ORDER BY rp.created_at,rp.id`, [groupId, cycleId, meetingId]);
}

export async function meetingReconciliation(client, groupId, cycleId, meetingId) {
  return (await rows(client, `
    SELECT mr.id,mr.status,mr.expected_savings_loan_balance,mr.counted_savings_loan_balance,
      mr.savings_loan_difference,mr.expected_social_fund_balance,mr.counted_social_fund_balance,
      mr.social_fund_difference,mr.notes,mr.created_at,
      concat_ws(' ',u.first_name,u.last_name) reconciled_by_name,
      EXISTS(SELECT 1 FROM reconciliation_signatures rs WHERE rs.reconciliation_id=mr.id) signature_recorded
    FROM meeting_reconciliations mr
    JOIN users u ON u.id=mr.created_by
    WHERE mr.group_id=$1 AND mr.cycle_id=$2 AND mr.meeting_id=$3
    ORDER BY mr.created_at DESC,mr.id DESC LIMIT 1`, [groupId, cycleId, meetingId]))[0] || null;
}

export async function meetingTotals(client, groupId, cycleId, meetingId) {
  return (await rows(client, `
    SELECT
      (SELECT COALESCE(SUM(CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount WHEN 'REVERSAL' THEN -st.amount ELSE 0 END),0)::numeric(18,2)
        FROM savings_transactions st WHERE st.group_id=$1 AND st.cycle_id=$2 AND st.meeting_id=$3) net_savings,
      (SELECT COALESCE(SUM(CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN sf.amount WHEN 'REVERSAL' THEN -sf.amount ELSE 0 END),0)::numeric(18,2)
        FROM social_fund_transactions sf WHERE sf.group_id=$1 AND sf.cycle_id=$2 AND sf.meeting_id=$3) social_fund_contributions,
      (SELECT COALESCE(SUM(f.amount) FILTER(WHERE f.transaction_kind='FINE'),0)::numeric(18,2)
        FROM fine_transactions f WHERE f.group_id=$1 AND f.cycle_id=$2 AND f.meeting_id=$3) fines_assessed,
      (SELECT COALESCE(SUM(CASE f.transaction_kind WHEN 'FINE' THEN f.amount WHEN 'REVERSAL' THEN -f.amount ELSE 0 END),0)::numeric(18,2)
        FROM fine_transactions f WHERE f.group_id=$1 AND f.cycle_id=$2 AND f.meeting_id=$3) fines_collected,
      (SELECT COUNT(*)::int FROM loan_requests lr WHERE lr.group_id=$1 AND lr.cycle_id=$2 AND lr.request_meeting_id=$3) loan_requests,
      (SELECT COUNT(*)::int FROM loan_decisions d WHERE d.group_id=$1 AND d.cycle_id=$2 AND d.decision_meeting_id=$3 AND d.decision='APPROVED') loans_approved,
      (SELECT COUNT(*)::int FROM loan_decisions d WHERE d.group_id=$1 AND d.cycle_id=$2 AND d.decision_meeting_id=$3 AND d.decision='REJECTED') loans_rejected,
      (SELECT COUNT(*)::int FROM loans l WHERE l.group_id=$1 AND l.cycle_id=$2 AND l.disbursement_meeting_id=$3) loans_disbursed,
      (SELECT COALESCE(SUM(l.principal_disbursed),0)::numeric(18,2) FROM loans l WHERE l.group_id=$1 AND l.cycle_id=$2 AND l.disbursement_meeting_id=$3) loan_principal_disbursed,
      (SELECT COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.payment_amount WHEN 'REVERSAL' THEN -rp.payment_amount ELSE 0 END),0)::numeric(18,2)
        FROM loan_repayments rp WHERE rp.group_id=$1 AND rp.cycle_id=$2 AND rp.meeting_id=$3) loan_repayments,
      (SELECT COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.principal_component WHEN 'REVERSAL' THEN -rp.principal_component ELSE 0 END),0)::numeric(18,2)
        FROM loan_repayments rp WHERE rp.group_id=$1 AND rp.cycle_id=$2 AND rp.meeting_id=$3) principal_repaid,
      (SELECT COALESCE(SUM(CASE rp.transaction_kind WHEN 'PAYMENT' THEN rp.service_charge_component WHEN 'REVERSAL' THEN -rp.service_charge_component ELSE 0 END),0)::numeric(18,2)
        FROM loan_repayments rp WHERE rp.group_id=$1 AND rp.cycle_id=$2 AND rp.meeting_id=$3) service_charge_collected`,
    [groupId, cycleId, meetingId]))[0];
}
