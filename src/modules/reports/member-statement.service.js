import { pool } from "@/lib/db/pool";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { getGroupActorContext } from "@/modules/group-access/group-access.service";
import { getShareout } from "@/modules/shareout/shareout.service";
import { assembleFines, assembleLoans, canAccessCycleReports, cents, money, sumMoney, transactionSign } from "./cycle-report.service";
import * as repository from "./member-statement.repository";

const statusCount = (rows, status) => rows.filter((row) => row.status === status).length;
const byMeeting = (transactions, positiveKind, shares = false) => {
  const values = new Map();
  for (const row of transactions) {
    const key = row.meeting_id || "unassigned";
    const item = values.get(key) || { meetingId: row.meeting_id || null, meetingNumber: row.meeting_number || null, date: row.meeting_date || row.effective_date, purchases: 0, reversal: 0, sharesPurchased: 0, sharesReversed: 0 };
    const sign = transactionSign(row.transaction_kind, positiveKind);
    if (sign > 0) { item.purchases += cents(row.amount); if (shares) item.sharesPurchased += Number(row.shares || 0); }
    if (sign < 0) { item.reversal += cents(row.amount); if (shares) item.sharesReversed += Number(row.shares || 0); }
    values.set(key, item);
  }
  return [...values.values()].map((item) => ({ ...item, purchases: money(item.purchases), reversal: money(item.reversal), netSavings: money(item.purchases - item.reversal), contribution: money(item.purchases), netContribution: money(item.purchases - item.reversal) }));
};

export function canAccessMemberStatement(user, actor, metadata, access = "view") {
  if (canAccessCycleReports(user, actor, access)) return true;
  return metadata.linked_user_id === user.id;
}

export function assembleMemberStatement(raw, { user, generatedAt = new Date().toISOString() }) {
  if (!raw.metadata) throw new NotFoundError("Member statement not found");
  const attendanceRows = raw.attendance.map((row) => ({ meetingId: row.meeting_id, meetingNumber: row.meeting_number, meetingDate: row.meeting_date, meetingStatus: row.meeting_status, status: row.attendance_status || "UNMARKED", notes: row.notes || null, recordedAt: row.recorded_at || null, recordedBy: row.recorded_by_name || null }));
  const savingsRows = byMeeting(raw.savingsTransactions, "PURCHASE", true);
  const socialRows = byMeeting(raw.socialFundTransactions, "CONTRIBUTION");
  const fines = assembleFines(raw.fineTransactions.map((row) => ({ ...row, member_code: raw.metadata.member_code, member_name: raw.metadata.member_name })));
  const loans = assembleLoans(raw.loans, raw.loanTransactions);
  const statementShareout = raw.shareout?.entitlements.find((row) => row.member_id === raw.metadata.member_id) || null;
  const shareout = statementShareout ? { status: raw.shareout.shareout.status, netSavings: statementShareout.net_savings, entitlement: statementShareout.final_entitlement, paid: statementShareout.net_paid, remaining: money(Math.max(0, cents(statementShareout.final_entitlement) - cents(statementShareout.net_paid))), payoutHistory: statementShareout.payout_history || [] } : { status: "NOT STARTED", netSavings: null, entitlement: null, paid: null, remaining: null, payoutHistory: [] };
  const summary = { meetingsEligible: attendanceRows.length, present: statusCount(attendanceRows, "PRESENT"), absent: statusCount(attendanceRows, "ABSENT"), late: statusCount(attendanceRows, "LATE"), excused: statusCount(attendanceRows, "EXCUSED"), netSavings: sumMoney(savingsRows, (row) => row.netSavings), socialFundContributions: sumMoney(socialRows, (row) => row.netContribution), finesAssessed: fines.totals.assessed, finesCollected: fines.totals.collected, principalBorrowed: loans.totals.disbursed, serviceCharge: sumMoney(loans.rows, (row) => row.serviceCharge), loanRepayments: loans.totals.repaid, principalOutstanding: loans.totals.principalOutstanding, serviceChargeOutstanding: loans.totals.serviceChargeOutstanding, shareoutEntitlement: shareout.entitlement, shareoutPaid: shareout.paid };
  return { metadata: { productName: "Visave", groupId: raw.metadata.group_id, groupName: raw.metadata.group_name, groupCode: raw.metadata.group_code, state: raw.metadata.state_name, lga: raw.metadata.lga_name, community: raw.metadata.community_name, operationMode: raw.metadata.operation_mode, cycleId: raw.metadata.cycle_id, cycleNumber: raw.metadata.cycle_number, cycleStatus: raw.metadata.cycle_status, memberId: raw.metadata.member_id, memberCode: raw.metadata.member_code, memberName: raw.metadata.member_name, generatedAt, generatedBy: { id: user.id, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), email: user.email || null } }, participation: { startDate: raw.metadata.participation_start_date, endDate: raw.metadata.participation_end_date }, attendance: { rows: attendanceRows, totals: summary }, savings: { rows: savingsRows, total: summary.netSavings }, socialFund: { rows: socialRows, total: summary.socialFundContributions }, fines, loans, loanTransactions: loans.transactions, shareout, summary };
}

async function loadRaw(client, user, groupId, cycleId, memberId, access) {
  const metadata = await repository.statementMetadata(client, user.organization_id, groupId, cycleId, memberId);
  if (!metadata) throw new NotFoundError("Member statement not found");
  const actor = await getGroupActorContext(user, groupId, client);
  if (!canAccessMemberStatement(user, actor, metadata, access)) throw new AuthorizationError("MEMBER_STATEMENT_ACCESS_DENIED");
  const [attendance, savingsTransactions, socialFundTransactions, fineTransactions, loans, loanTransactions, shareout] = await Promise.all([repository.attendance(client, groupId, cycleId, memberId), repository.savingsTransactions(client, groupId, cycleId, memberId), repository.socialFundTransactions(client, groupId, cycleId, memberId), repository.fineTransactions(client, groupId, cycleId, memberId), repository.loans(client, groupId, cycleId, memberId), repository.loanTransactions(client, groupId, cycleId, memberId), getShareout(groupId, cycleId, null, client)]);
  return { metadata, attendance, savingsTransactions, socialFundTransactions, fineTransactions, loans, loanTransactions, shareout };
}

export async function getMemberStatementWithClient(user, groupId, cycleId, memberId, client, access = "view") { return assembleMemberStatement(await loadRaw(client, user, groupId, cycleId, memberId, access), { user }); }
export async function getMemberStatement(user, groupId, cycleId, memberId, access = "view") { const client = await pool.connect(); try { await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); const report = await getMemberStatementWithClient(user, groupId, cycleId, memberId, client, access); await client.query("COMMIT"); return report; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
