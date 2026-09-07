import { dashboardScopeSql } from "./dashboard-scope.js";

function params(user, scope) {
  return [user.organization_id, user.id, user.roles || [], scope.scopeType, scope.groupIds || []];
}

export async function dashboardMetrics(client, user, scope) {
  const scoped = dashboardScopeSql();
  return (await client.query(
    `WITH scoped_groups AS (
       SELECT g.id,g.facilitator_user_id FROM vsla_groups g WHERE ${scoped}
     ), relevant_cycles AS (
       SELECT cy.id,cy.group_id FROM vsla_cycles cy JOIN scoped_groups sg ON sg.id=cy.group_id
       WHERE cy.status IN ('ACTIVE','CLOSING','CLOSED')
     ), active_cycles AS (
       SELECT cy.id,cy.group_id,cy.constitution_id,cy.cycle_number,cy.start_date,cy.expected_end_date
       FROM vsla_cycles cy JOIN scoped_groups sg ON sg.id=cy.group_id WHERE cy.status='ACTIVE'
     ), ledger_balances AS (
       SELECT
         COALESCE(SUM(CASE WHEN la.account_code='SOCIAL_FUND_CASH'
           THEN CASE le.entry_side WHEN 'DEBIT' THEN le.amount WHEN 'CREDIT' THEN -le.amount ELSE 0 END ELSE 0 END),0)::numeric(18,2) current_social_fund_balance,
         COALESCE(SUM(CASE WHEN la.account_code='LOANS_RECEIVABLE'
           THEN CASE le.entry_side WHEN 'DEBIT' THEN le.amount ELSE -le.amount END ELSE 0 END),0)::numeric(18,2) outstanding_loans
       FROM active_cycles ac JOIN ledger_accounts la ON la.cycle_id=ac.id
       LEFT JOIN ledger_entries le ON le.ledger_account_id=la.id
     ), lifetime_savings AS (
       SELECT COALESCE(SUM(CASE st.transaction_kind
         WHEN 'PURCHASE' THEN st.amount
         WHEN 'REVERSAL' THEN -st.amount
         ELSE 0
       END),0)::numeric(18,2) total_savings_ever
       FROM savings_transactions st
       JOIN relevant_cycles rc ON rc.id=st.cycle_id AND rc.group_id=st.group_id
     ), current_cycle_savings AS (
       SELECT COALESCE(SUM(CASE st.transaction_kind
         WHEN 'PURCHASE' THEN st.amount
         WHEN 'REVERSAL' THEN -st.amount
         ELSE 0
       END),0)::numeric(18,2) current_cycle_savings
       FROM savings_transactions st
       JOIN active_cycles ac ON ac.id=st.cycle_id AND ac.group_id=st.group_id
     ), lifetime_social_fund_contributions AS (
       SELECT COALESCE(SUM(CASE sf.transaction_kind
         WHEN 'CONTRIBUTION' THEN sf.amount
         WHEN 'REVERSAL' THEN -sf.amount
         ELSE 0
       END),0)::numeric(18,2) total_social_fund_contributions
       FROM social_fund_transactions sf
       JOIN relevant_cycles rc ON rc.id=sf.cycle_id AND rc.group_id=sf.group_id
     )
     SELECT
       (SELECT COUNT(*)::int FROM scoped_groups) total_groups,
       (SELECT COUNT(*)::int FROM scoped_groups sg JOIN vsla_groups g ON g.id=sg.id WHERE g.status='ACTIVE') active_groups,
       (SELECT COUNT(DISTINCT facilitator_user_id)::int FROM scoped_groups WHERE facilitator_user_id IS NOT NULL) total_facilitators,
       (SELECT COUNT(*)::int FROM group_members gm JOIN scoped_groups sg ON sg.id=gm.group_id) total_members,
       (SELECT COUNT(*)::int FROM cycle_memberships cm JOIN active_cycles ac ON ac.id=cm.cycle_id) current_cycle_participants,
       (SELECT COUNT(*)::int FROM active_cycles) active_cycles,
       (SELECT COUNT(*)::int FROM vsla_meetings vm JOIN scoped_groups sg ON sg.id=vm.group_id WHERE vm.status='CLOSED') meetings_held,
       (SELECT COUNT(*)::int FROM loans l JOIN active_cycles ac ON ac.id=l.cycle_id WHERE l.settled_at IS NULL AND l.voided_at IS NULL) active_borrowers,
       (SELECT total_savings_ever FROM lifetime_savings) total_savings_ever,
       (SELECT current_cycle_savings FROM current_cycle_savings) current_cycle_savings,
       (SELECT total_social_fund_contributions FROM lifetime_social_fund_contributions) total_social_fund_contributions,
       (SELECT current_social_fund_balance FROM ledger_balances) current_social_fund_balance,
       (SELECT outstanding_loans FROM ledger_balances) outstanding_loans`,
    params(user, scope),
  )).rows[0];
}

export async function dashboardGroups(client, user, scope) {
  const scoped = dashboardScopeSql();
  return (await client.query(
    `SELECT g.id,g.group_code,g.name,g.status,g.operation_mode,g.facilitator_user_id,
       COALESCE(c.name,l.name,s.name) community, l.name lga_name,s.name state_name,
       CONCAT_WS(' ',u.first_name,u.last_name) facilitator_name,
       COUNT(DISTINCT gm.id)::int members,COUNT(DISTINCT cm.member_id)::int current_cycle_participants,
       cy.id cycle_id,cy.cycle_number,cy.start_date,cy.expected_end_date,
       gc.share_value,
       COUNT(DISTINCT vm.id) FILTER(WHERE vm.status='CLOSED')::int meetings_held
     FROM vsla_groups g
     LEFT JOIN communities c ON c.id=g.community_id LEFT JOIN lgas l ON l.id=g.lga_id LEFT JOIN states s ON s.id=g.state_id
     LEFT JOIN users u ON u.id=g.facilitator_user_id
     LEFT JOIN group_members gm ON gm.group_id=g.id
     LEFT JOIN vsla_cycles cy ON cy.group_id=g.id AND cy.status='ACTIVE'
     LEFT JOIN cycle_memberships cm ON cm.cycle_id=cy.id
     LEFT JOIN group_constitutions gc ON gc.id=cy.constitution_id
     LEFT JOIN vsla_meetings vm ON vm.group_id=g.id
     WHERE ${scoped}
     GROUP BY g.id,c.name,l.name,s.name,u.id,cy.id,gc.share_value
     ORDER BY g.name`,
    params(user, scope),
  )).rows;
}
