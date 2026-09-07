export async function memberCycleHistory(client, groupId, memberId) {
  return (await client.query(`
    SELECT cy.id,cy.cycle_number,cy.status,
      EXISTS(SELECT 1 FROM cycle_memberships cm
        WHERE cm.group_id=cy.group_id AND cm.cycle_id=cy.id AND cm.member_id=$2) participates
    FROM vsla_cycles cy WHERE cy.group_id=$1 ORDER BY cy.cycle_number`,
  [groupId, memberId])).rows;
}

export async function memberCurrentCycleSummary(client, groupId, memberId) {
  return (await client.query(`
    WITH current_cycle AS (SELECT id FROM vsla_cycles WHERE group_id=$1 AND status='ACTIVE')
    SELECT
      (SELECT COALESCE(SUM(CASE transaction_kind WHEN 'PURCHASE' THEN shares ELSE -shares END),0)::int
       FROM savings_transactions WHERE group_id=$1 AND member_id=$2 AND cycle_id IN (SELECT id FROM current_cycle)) shares,
      (SELECT COALESCE(SUM(CASE transaction_kind WHEN 'PURCHASE' THEN amount ELSE -amount END),0)::numeric(18,2)
       FROM savings_transactions WHERE group_id=$1 AND member_id=$2 AND cycle_id IN (SELECT id FROM current_cycle)) savings,
      (SELECT COALESCE(SUM(CASE transaction_kind WHEN 'CONTRIBUTION' THEN amount ELSE -amount END),0)::numeric(18,2)
       FROM social_fund_transactions WHERE group_id=$1 AND member_id=$2 AND cycle_id IN (SELECT id FROM current_cycle)) social,
      (SELECT COALESCE(SUM(CASE transaction_kind WHEN 'FINE' THEN amount ELSE -amount END),0)::numeric(18,2)
       FROM fine_transactions WHERE group_id=$1 AND member_id=$2 AND cycle_id IN (SELECT id FROM current_cycle)) fines,
      (SELECT COUNT(*)::int FROM loans WHERE group_id=$1 AND member_id=$2
       AND cycle_id IN (SELECT id FROM current_cycle) AND voided_at IS NULL) loans`,
  [groupId, memberId])).rows[0];
}
