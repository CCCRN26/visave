import { pool } from "@/lib/db/pool";
import { NotFoundError } from "@/lib/errors";
import { cycleReadiness, cycleTransitionState, getShareout } from "./shareout.service";
import { getFinalReconciliationRefresh } from "@/modules/meetings/meeting.service";

export async function getCloseoutWorkspace(groupId, cycleId, client = pool) {
  const cycle = (await client.query(
    `SELECT cy.id,cy.group_id,cy.cycle_number,cy.status,cy.start_date::text,cy.expected_end_date::text,
       cy.expected_shareout_date::text,cy.meeting_day_of_week,g.name group_name,gc.version_number constitution_version
     FROM vsla_cycles cy JOIN vsla_groups g ON g.id=cy.group_id
     JOIN group_constitutions gc ON gc.id=cy.constitution_id
     WHERE cy.id=$1 AND cy.group_id=$2`,
    [cycleId, groupId],
  )).rows[0];
  if (!cycle) throw new NotFoundError("Cycle not found");

  const finalMeeting = (await client.query(
    `SELECT m.id,m.meeting_number,m.meeting_date::text,m.status,
       attendance.member_count,attendance.unmarked_attendance,
       lr.id latest_reconciliation_id,lr.status latest_reconciliation_status,
       lr.expected_savings_loan_balance,lr.expected_social_fund_balance
     FROM vsla_meetings m
     LEFT JOIN LATERAL(
       SELECT COUNT(*)::int member_count,
         COUNT(*) FILTER(WHERE a.attendance_status='UNMARKED')::int unmarked_attendance
       FROM meeting_attendance a WHERE a.meeting_id=m.id
     ) attendance ON true
     LEFT JOIN LATERAL(
       SELECT r.id,r.status,r.expected_savings_loan_balance,r.expected_social_fund_balance
       FROM meeting_reconciliations r WHERE r.meeting_id=m.id
       ORDER BY r.created_at DESC,r.id DESC LIMIT 1
     ) lr ON true
     WHERE m.group_id=$1 AND m.cycle_id=$2 AND m.status<>'CANCELLED'
       AND m.meeting_number=(SELECT MAX(x.meeting_number) FROM vsla_meetings x WHERE x.cycle_id=$2 AND x.status<>'CANCELLED')
     LIMIT 1`,
    [groupId, cycleId],
  )).rows[0] || null;

  const [readiness, shareout, transition, finalReconciliation, constitutions] = await Promise.all([
    cycleReadiness(groupId, cycleId),
    getShareout(groupId, cycleId),
    cycleTransitionState(groupId, cycleId),
    getFinalReconciliationRefresh(groupId, cycleId),
    client.query("SELECT id,version_number,status FROM group_constitutions WHERE group_id=$1 AND status='APPROVED' ORDER BY version_number DESC", [groupId]).then((result) => result.rows),
  ]);

  const nextCycle = transition.nextCycle;
  const [previousParticipants,nextParticipants,eligibleMembers,nextOfficers]=await Promise.all([
    client.query(`SELECT m.id,m.member_code,m.first_name,m.last_name,m.date_joined::text FROM cycle_memberships cm JOIN group_members m ON m.id=cm.member_id WHERE cm.cycle_id=$1 ORDER BY m.member_number`,[cycleId]).then(r=>r.rows),
    nextCycle?client.query(`SELECT cm.member_id,cm.participation_start_date::text,m.member_code,m.first_name,m.last_name FROM cycle_memberships cm JOIN group_members m ON m.id=cm.member_id WHERE cm.cycle_id=$1 ORDER BY m.member_number`,[nextCycle.id]).then(r=>r.rows):[],
    nextCycle?client.query(`SELECT m.id,m.member_code,m.first_name,m.last_name,m.date_joined::text FROM group_members m WHERE m.group_id=$1 AND m.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM cycle_memberships cm WHERE cm.cycle_id=$2 AND cm.member_id=m.id) ORDER BY m.member_number`,[groupId,nextCycle.id]).then(r=>r.rows):[],
    nextCycle?client.query(`SELECT o.*,concat(m.first_name,' ',m.last_name) member_name FROM group_officer_assignments o JOIN group_members m ON m.id=o.member_id WHERE o.cycle_id=$1 AND o.status='ACTIVE' ORDER BY o.position_code`,[nextCycle.id]).then(r=>r.rows):[],
  ]);
  const nextBalances = nextCycle ? Object.fromEntries((await client.query(
    `SELECT a.account_code,COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) balance
     FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id
     WHERE a.cycle_id=$1 GROUP BY a.account_code`,
    [nextCycle.id],
  )).rows.map((row) => [row.account_code, row.balance])) : {};

  const paidMembers = shareout?.entitlements.filter((item) => item.net_paid === item.final_entitlement).length || 0;
  const paidAmount = shareout?.entitlements.reduce((sum, item) => sum + Number(item.net_paid), 0) || 0;
  const entitlementAmount = shareout?.entitlements.reduce((sum, item) => sum + Number(item.final_entitlement), 0) || 0;
  const finalMeetingCurrent = Boolean(finalMeeting?.latest_reconciliation_id &&
    finalMeeting.latest_reconciliation_status === "BALANCED" &&
    finalMeeting.expected_savings_loan_balance === (finalReconciliation.balances.SAVINGS_LOAN_CASH || "0.00") &&
    finalMeeting.expected_social_fund_balance === (finalReconciliation.balances.SOCIAL_FUND_CASH || "0.00"));

  return {
    cycle,
    finalMeeting,
    readiness,
    shareout,
    transition,
    finalReconciliation,
    constitutions,
    nextBalances,
    payoutProgress: { paidMembers, totalMembers: shareout?.entitlements.length || 0, paidAmount: paidAmount.toFixed(2), entitlementAmount: entitlementAmount.toFixed(2) },
    finalMeetingCurrent,
    previousParticipants,nextParticipants,eligibleMembers,nextOfficers,
  };
}
