import { pool } from "@/lib/db/pool";
import { AppError, AuthorizationError, NotFoundError } from "@/lib/errors";
import { canGroupAction, getGroupActorContext, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getShareout } from "@/modules/shareout/shareout.service";
import * as repository from "./cycle-report.repository";

const REPORT_STATUSES = Object.freeze({
  ACTIVE: "IN PROGRESS",
  CLOSING: "CLOSE-OUT IN PROGRESS",
  CLOSED: "FINAL",
});
const ATTENDANCE_CODES = Object.freeze({ PRESENT: "P", ABSENT: "A", LATE: "L", EXCUSED: "E", UNMARKED: "U" });

export const cents = (value) => Math.round(Number(value || 0) * 100);
export const money = (value) => (Number(value || 0) / 100).toFixed(2);
export const sumMoney = (items, selector = (item) => item) => money(items.reduce((sum, item) => sum + cents(selector(item)), 0));
export const transactionSign = (kind, positiveKind) => kind === positiveKind ? 1 : kind === "REVERSAL" ? -1 : 0;
const isoDate = (value) => value ? String(value).slice(0, 10) : null;
const isoDateTime = (value) => value ? new Date(value).toISOString() : null;
const pairKey = (memberId, meetingId) => `${memberId}:${meetingId}`;
const balanceMap = (rows) => Object.fromEntries(rows.map((row) => [row.account_code, row.balance]));
const currentOfficer = (actor) => Boolean(
  actor?.linked_member_id && actor?.cycle_membership_id && actor?.member_status === "ACTIVE" &&
  (actor.isChairperson || actor.isRecordKeeper || ["CHAIRPERSON", "RECORD_KEEPER"].includes(actor.officer_position)),
);

export function canAccessCycleReports(user, actor, access = "view") {
  const action = access === "export" ? GROUP_ACTION.REPORT_EXPORT : GROUP_ACTION.REPORT_VIEW;
  if (!canGroupAction(user, actor, action)) return false;
  if (currentOfficer(actor)) return true;
  if (user.permissions?.includes("report.view") || user.permissions?.includes("report.export")) return true;
  return Boolean(user.roles?.includes("FACILITATOR") && actor.is_assigned_facilitator && actor.is_active_facilitator && actor.has_facilitator_scope);
}

export async function assertCycleReportAccess(user, groupId, client = pool, access = "view") {
  const actor = await getGroupActorContext(user, groupId, client);
  if (!canAccessCycleReports(user, actor, access)) throw new AuthorizationError("REPORT_ACCESS_DENIED");
  return actor;
}

export async function listCycleReports(user, groupId, client = pool) {
  await assertCycleReportAccess(user, groupId, client);
  return (await repository.listCycles(client, user.organization_id, groupId)).map((cycle) => ({
    ...cycle,
    reportStatus: REPORT_STATUSES[cycle.status],
  }));
}

function eligibleAt(participant, meetingDate) {
  return participant.participation_start_date <= meetingDate &&
    (!participant.participation_end_date || participant.participation_end_date >= meetingDate);
}

function transactionMatrix(participants, meetings, transactions, positiveKind, valueField) {
  const values = new Map();
  for (const transaction of transactions) {
    const key = pairKey(transaction.member_id, transaction.meeting_id);
    const sign = transaction.transaction_kind === positiveKind ? 1 : transaction.transaction_kind === "REVERSAL" ? -1 : 0;
    values.set(key, (values.get(key) || 0) + sign * Number(transaction[valueField] || 0));
  }
  return participants.map((participant) => {
    const byMeeting = {};
    for (const meeting of meetings) {
      byMeeting[meeting.id] = eligibleAt(participant, meeting.meeting_date)
        ? (valueField === "shares" ? values.get(pairKey(participant.member_id, meeting.id)) || 0 : money(cents(values.get(pairKey(participant.member_id, meeting.id)) || 0)))
        : null;
    }
    return { ...participant, byMeeting };
  });
}

function assembleAttendance(participants, meetings, attendanceRows) {
  const values = new Map(attendanceRows.map((row) => [pairKey(row.member_id, row.meeting_id), row.attendance_status]));
  const rows = participants.map((participant) => {
    const byMeeting = {};
    const totals = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const meeting of meetings) {
      if (!eligibleAt(participant, meeting.meeting_date)) {
        byMeeting[meeting.id] = "—";
        continue;
      }
      const state = values.get(pairKey(participant.member_id, meeting.id));
      byMeeting[meeting.id] = state ? ATTENDANCE_CODES[state] : null;
      if (state && Object.hasOwn(totals, state.toLowerCase())) totals[state.toLowerCase()] += 1;
    }
    return { ...participant, byMeeting, totals };
  });
  return { meetings, rows };
}

export function assembleSavings(participants, meetings, transactions) {
  const amountRows = transactionMatrix(participants, meetings, transactions, "PURCHASE", "amount");
  const shareRows = transactionMatrix(participants, meetings, transactions, "PURCHASE", "shares");
  const sharesByMember = new Map(shareRows.map((row) => [row.member_id, row]));
  const rows = amountRows.map((row) => ({
    ...row,
    totalShares: Object.values(sharesByMember.get(row.member_id).byMeeting).reduce((sum, value) => sum + Number(value || 0), 0),
    totalSavings: sumMoney(Object.values(row.byMeeting).filter((value) => value !== null)),
  }));
  const meetingTotals = Object.fromEntries(meetings.map((meeting) => [meeting.id, sumMoney(rows, (row) => row.byMeeting[meeting.id])])) ;
  return {
    meetings,
    rows,
    meetingTotals,
    totalShares: rows.reduce((sum, row) => sum + row.totalShares, 0),
    totalSavings: sumMoney(rows, (row) => row.totalSavings),
  };
}

export function assembleSocialFund(participants, meetings, transactions, transfers, balances) {
  const rows = transactionMatrix(participants, meetings, transactions, "CONTRIBUTION", "amount").map((row) => ({
    ...row,
    totalContribution: sumMoney(Object.values(row.byMeeting).filter((value) => value !== null)),
  }));
  const carryIn = transfers.filter((row) => row.direction === "CARRY_IN");
  const carryOut = transfers.filter((row) => row.direction === "CARRY_OUT");
  return {
    meetings,
    rows,
    meetingTotals: Object.fromEntries(meetings.map((meeting) => [meeting.id, sumMoney(rows, (row) => row.byMeeting[meeting.id])])),
    summary: {
      openingCarryIn: sumMoney(carryIn, (row) => row.amount),
      memberContributions: sumMoney(rows, (row) => row.totalContribution),
      payouts: null,
      otherInflows: null,
      otherOutflows: null,
      currentClosingBalance: balances.SOCIAL_FUND_CASH || "0.00",
      carriedForward: sumMoney(carryOut, (row) => row.amount),
    },
    transfers,
  };
}

export function assembleFines(transactions) {
  const reversals = new Map();
  for (const row of transactions.filter((item) => item.transaction_kind === "REVERSAL")) {
    const key = row.original_fine_transaction_id;
    reversals.set(key, (reversals.get(key) || 0) + cents(row.amount));
  }
  const rows = transactions.filter((row) => row.transaction_kind === "FINE").map((row) => {
    const reversed = reversals.get(row.id) || 0;
    return {
      id: row.id,
      date: row.effective_date,
      meetingId: row.meeting_id,
      meetingNumber: row.meeting_number,
      memberId: row.member_id,
      memberCode: row.member_code,
      memberName: row.member_name,
      reason: row.reason || row.fine_name || "Fine",
      reference: row.reference_code,
      amountAssessed: money(cents(row.amount)),
      amountPaid: money(cents(row.amount) - reversed),
      amountReversed: money(reversed),
      outstanding: null,
      status: reversed >= cents(row.amount) ? "REVERSED" : "COLLECTED",
    };
  });
  return {
    rows,
    totals: {
      assessed: sumMoney(rows, (row) => row.amountAssessed),
      collected: sumMoney(rows, (row) => row.amountPaid),
      reversed: sumMoney(rows, (row) => row.amountReversed),
      outstanding: null,
    },
  };
}

function signedLoanAmount(row, field = "amount") {
  return row.is_reversal ? -cents(row[field]) : cents(row[field]);
}

export function assembleLoans(loanRows, transactionRows) {
  const rows = loanRows.map((row) => {
    const voided = Boolean(row.voided_at);
    const totalRepaid = voided ? 0 : cents(row.total_repaid);
    const principalRepaid = voided ? 0 : cents(row.principal_repaid);
    const chargeCollected = voided ? 0 : cents(row.service_charge_collected);
    const principal = voided ? 0 : cents(row.principal_disbursed);
    const charge = voided ? 0 : cents(row.service_charge_total_due);
    return {
      id: row.id,
      loanCode: row.loan_code,
      memberId: row.member_id,
      memberCode: row.member_code,
      borrower: row.borrower_name,
      purpose: row.purpose,
      requestDate: isoDate(row.requested_at),
      requestedAmount: money(cents(row.requested_principal)),
      approvedAmount: money(cents(row.approved_principal)),
      disbursementDate: row.disbursement_date,
      principalDisbursed: money(principal),
      serviceCharge: money(charge),
      totalDue: money(principal + charge),
      totalRepaid: money(totalRepaid),
      principalOutstanding: money(Math.max(0, principal - principalRepaid)),
      serviceChargeOutstanding: money(Math.max(0, charge - chargeCollected)),
      dueDate: row.due_date,
      status: row.status,
    };
  });
  const transactions = transactionRows.map((row) => ({
    id: row.id,
    date: row.effective_date,
    meetingNumber: row.meeting_number,
    borrower: row.borrower_name,
    memberCode: row.member_code,
    loanId: row.loan_id,
    loanCode: row.loan_code,
    reference: row.reference_code,
    transactionType: row.transaction_type,
    amount: money(cents(row.amount)),
    principalComponent: money(cents(row.principal_component)),
    serviceChargeComponent: money(cents(row.service_charge_component)),
    isReversal: Boolean(row.is_reversal),
    reversalOfTransactionId: row.reversal_of_transaction_id,
  }));
  const disbursementTransactions = transactionRows.filter((row) => row.transaction_type.startsWith("LOAN_DISBURSEMENT"));
  const repaymentTransactions = transactionRows.filter((row) => row.transaction_type.startsWith("LOAN_REPAYMENT"));
  return {
    rows,
    transactions,
    totals: {
      disbursed: money(disbursementTransactions.reduce((sum, row) => sum + signedLoanAmount(row), 0)),
      repaid: money(repaymentTransactions.reduce((sum, row) => sum + signedLoanAmount(row), 0)),
      serviceChargeCollected: money(repaymentTransactions.reduce((sum, row) => sum + signedLoanAmount(row, "service_charge_component"), 0)),
      principalOutstanding: sumMoney(rows, (row) => row.principalOutstanding),
      serviceChargeOutstanding: sumMoney(rows, (row) => row.serviceChargeOutstanding),
    },
  };
}

function assembleCashbook(rows) {
  return {
    savingsLoan: rows.filter((row) => row.fund_type === "SAVINGS_LOAN").map(cashbookRow),
    socialFund: rows.filter((row) => row.fund_type === "SOCIAL_FUND").map(cashbookRow),
  };
}

function cashbookRow(row) {
  return {
    id: row.id,
    date: row.effective_date,
    meetingNumber: row.meeting_number,
    reference: row.reference_code,
    description: row.transaction_type,
    accountCode: row.account_code,
    account: row.account_name,
    debit: row.entry_side === "DEBIT" ? money(cents(row.amount)) : "0.00",
    credit: row.entry_side === "CREDIT" ? money(cents(row.amount)) : "0.00",
  };
}

function assembleShareout(data) {
  if (!data) return { status: "NOT STARTED", socialFundTreatment: "NOT INCLUDED IN SHARE-OUT", rows: [], summary: null };
  const { shareout, entitlements } = data;
  const rows = entitlements.map((row) => ({
    memberId: row.member_id,
    memberCode: row.member_code_snapshot,
    memberName: row.member_name_snapshot,
    netShares: Number(row.net_shares),
    netSavings: row.net_savings,
    shareRatio: Number(shareout.total_net_shares) ? Number(row.net_shares) / Number(shareout.total_net_shares) : null,
    entitlement: row.final_entitlement,
    paid: row.net_paid,
    remaining: money(Math.max(0, cents(row.final_entitlement) - cents(row.net_paid))),
  }));
  return {
    id: shareout.id,
    status: shareout.status,
    preparedAt: isoDateTime(shareout.prepared_at),
    approvedAt: isoDateTime(shareout.approved_at),
    completedAt: isoDateTime(shareout.completed_at),
    socialFundTreatment: "NOT INCLUDED IN SHARE-OUT",
    rows,
    summary: {
      netMemberSavings: shareout.total_net_savings,
      fineIncomeIncluded: shareout.fine_income,
      serviceChargeIncomeIncluded: shareout.service_charge_income,
      distributableFund: shareout.distributable_fund,
      totalEntitlements: sumMoney(rows, (row) => row.entitlement),
      totalPaid: sumMoney(rows, (row) => row.paid),
      outstandingPayable: sumMoney(rows, (row) => row.remaining),
    },
  };
}

function meetingAggregateMap(rows, kind, field = "amount") {
  const result = new Map();
  for (const row of rows) {
    const sign = transactionSign(row.transaction_kind, kind);
    result.set(row.meeting_id, (result.get(row.meeting_id) || 0) + sign * cents(row[field]));
  }
  return result;
}

function buildMeetingSummary(raw, participants, reconciliationMap) {
  const attendanceByMeeting = new Map();
  for (const row of raw.attendance) {
    if (!attendanceByMeeting.has(row.meeting_id)) attendanceByMeeting.set(row.meeting_id, []);
    attendanceByMeeting.get(row.meeting_id).push(row);
  }
  const savings = meetingAggregateMap(raw.savingsTransactions, "PURCHASE");
  const social = meetingAggregateMap(raw.socialFundTransactions, "CONTRIBUTION");
  const fines = meetingAggregateMap(raw.fineTransactions, "FINE");
  const loanDisbursements = new Map();
  const loanRepayments = new Map();
  const loanCharges = new Map();
  for (const row of raw.loanTransactions) {
    const sign = row.is_reversal ? -1 : 1;
    if (row.transaction_type.startsWith("LOAN_DISBURSEMENT")) loanDisbursements.set(row.meeting_number, (loanDisbursements.get(row.meeting_number) || 0) + sign * cents(row.amount));
    if (row.transaction_type.startsWith("LOAN_REPAYMENT")) {
      loanRepayments.set(row.meeting_number, (loanRepayments.get(row.meeting_number) || 0) + sign * cents(row.amount));
      loanCharges.set(row.meeting_number, (loanCharges.get(row.meeting_number) || 0) + sign * cents(row.service_charge_component));
    }
  }
  return raw.meetings.map((meeting) => {
    const eligibleParticipants = participants.filter((participant) => eligibleAt(participant, meeting.meeting_date)).length;
    const attendance = (attendanceByMeeting.get(meeting.id) || []).filter((row) => participants.some((participant) => participant.member_id === row.member_id && eligibleAt(participant, meeting.meeting_date)));
    const count = (status) => attendance.filter((row) => row.attendance_status === status).length;
    return {
      id: meeting.id,
      meetingNumber: meeting.meeting_number,
      meetingDate: meeting.meeting_date,
      meetingStatus: meeting.status,
      eligibleParticipants,
      present: count("PRESENT"),
      absent: count("ABSENT"),
      late: count("LATE"),
      excused: count("EXCUSED"),
      savings: money(savings.get(meeting.id) || 0),
      socialFundContributions: money(social.get(meeting.id) || 0),
      finesCollected: money(fines.get(meeting.id) || 0),
      loansDisbursed: money(loanDisbursements.get(meeting.meeting_number) || 0),
      loanRepayments: money(loanRepayments.get(meeting.meeting_number) || 0),
      loanServiceChargeCollected: money(loanCharges.get(meeting.meeting_number) || 0),
      reconciliationStatus: reconciliationMap.get(meeting.id)?.status || null,
      attendanceRecorded: attendance.length > 0,
    };
  });
}

function averageAttendance(meetings) {
  const rates = meetings.filter((meeting) => meeting.attendanceRecorded && meeting.eligibleParticipants > 0).map((meeting) => ((meeting.present + meeting.late) / meeting.eligibleParticipants) * 100);
  return rates.length ? Number((rates.reduce((sum, rate) => sum + rate, 0) / rates.length).toFixed(2)) : null;
}

export function integrityCheck(name, left, right) {
  return { name, left: money(cents(left)), right: money(cents(right)), passed: cents(left) === cents(right) };
}

export function assembleCycleReport(raw, { user, generatedAt = new Date().toISOString() }) {
  if (!raw.metadata) throw new NotFoundError("Cycle report not found");
  const participants = raw.participants;
  const meetings = raw.meetings;
  const balances = balanceMap(raw.accountBalances);
  const reconciliationMap = new Map(raw.reconciliations.map((row) => [row.meeting_id, row]));
  const attendance = assembleAttendance(participants, meetings, raw.attendance);
  const savings = assembleSavings(participants, meetings, raw.savingsTransactions);
  const socialFund = assembleSocialFund(participants, meetings, raw.socialFundTransactions, raw.socialFundTransfers, balances);
  const fines = assembleFines(raw.fineTransactions);
  const loans = assembleLoans(raw.loans, raw.loanTransactions);
  const shareout = assembleShareout(raw.shareout);
  const meetingSummary = buildMeetingSummary(raw, participants, reconciliationMap);
  const finalMeeting = meetings.at(-1) || null;
  const finalReconciliation = finalMeeting ? reconciliationMap.get(finalMeeting.id) || null : null;
  const paidParticipants = shareout.rows.filter((row) => cents(row.paid) === cents(row.entitlement)).length;
  const cycleSummary = {
    cycleParticipants: participants.length,
    meetingsHeld: meetings.length,
    averageAttendance: averageAttendance(meetingSummary),
    netSavings: savings.totalSavings,
    socialFundMemberContributions: socialFund.summary.memberContributions,
    finesAssessed: fines.totals.assessed,
    finesCollected: fines.totals.collected,
    loansDisbursed: loans.totals.disbursed,
    loanRepayments: loans.totals.repaid,
    loanServiceChargeCollected: loans.totals.serviceChargeCollected,
    outstandingLoans: balances.LOANS_RECEIVABLE || "0.00",
    shareoutDistributableFund: shareout.summary?.distributableFund || null,
    shareoutEntitlements: shareout.summary?.totalEntitlements || null,
    shareoutPaid: shareout.summary?.totalPaid || null,
    socialFundOpeningCarryIn: socialFund.summary.openingCarryIn,
    socialFundCurrentClosingBalance: socialFund.summary.currentClosingBalance,
    socialFundCarriedForward: socialFund.summary.carriedForward,
    finalReconciliationStatus: finalReconciliation?.status || null,
  };
  const checks = [
    integrityCheck("Savings ledger", savings.totalSavings, cycleSummary.netSavings),
    integrityCheck("Social Fund contributions", socialFund.summary.memberContributions, cycleSummary.socialFundMemberContributions),
    integrityCheck("Fines collected", fines.totals.collected, cycleSummary.finesCollected),
    integrityCheck("Loans disbursed", sumMoney(loans.rows, (row) => row.principalDisbursed), cycleSummary.loansDisbursed),
    integrityCheck("Loan repayments", sumMoney(loans.rows, (row) => row.totalRepaid), cycleSummary.loanRepayments),
  ];
  if (shareout.summary) checks.push(integrityCheck("Share-out entitlements", shareout.summary.totalEntitlements, shareout.summary.distributableFund));
  const failed = checks.filter((check) => !check.passed);
  if (raw.metadata.cycle_status === "CLOSED" && failed.length) {
    throw new AppError("Closed cycle report totals do not reconcile", "REPORT_RECONCILIATION_FAILED", 409, { checks: failed });
  }
  return {
    metadata: {
      productName: "Visave",
      groupId: raw.metadata.group_id,
      groupCode: raw.metadata.group_code,
      groupName: raw.metadata.group_name,
      state: raw.metadata.state_name,
      lga: raw.metadata.lga_name,
      community: raw.metadata.community_name,
      operationMode: raw.metadata.operation_mode,
      cycleId: raw.metadata.cycle_id,
      cycleNumber: raw.metadata.cycle_number,
      cycleStatus: raw.metadata.cycle_status,
      startDate: raw.metadata.start_date,
      expectedEndDate: raw.metadata.expected_end_date,
      expectedShareoutDate: raw.metadata.expected_shareout_date,
      actualClosedDate: isoDate(raw.metadata.closed_at),
      reportStatus: REPORT_STATUSES[raw.metadata.cycle_status],
      generatedAt,
      generatedBy: { id: user.id, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), email: user.email || null },
      officers: raw.officers,
    },
    cycleSummary,
    meetingSummary,
    attendance,
    savings,
    socialFund,
    fines,
    loans: { rows: loans.rows, totals: loans.totals },
    loanTransactions: loans.transactions,
    cashbook: assembleCashbook(raw.cashbook),
    shareout,
    closure: {
      finalMeeting: finalMeeting ? { id: finalMeeting.id, meetingNumber: finalMeeting.meeting_number, meetingDate: finalMeeting.meeting_date, status: finalMeeting.status } : null,
      shareoutStatus: shareout.status,
      participantsPaid: paidParticipants,
      participantsTotal: shareout.rows.length,
      savingsLoanCashFinalBalance: balances.SAVINGS_LOAN_CASH || "0.00",
      loansReceivableFinalBalance: balances.LOANS_RECEIVABLE || "0.00",
      shareoutPayableFinalBalance: balances.SHAREOUT_PAYABLE || "0.00",
      socialFundCarriedForward: socialFund.summary.carriedForward,
      finalReconciliationStatus: finalReconciliation?.status || null,
      finalReconciliationDate: isoDateTime(finalReconciliation?.created_at),
      signatureRecorded: Boolean(finalReconciliation?.signature_recorded),
      cycleClosedDate: isoDateTime(raw.metadata.closed_at),
      cycleClosedBy: raw.metadata.cycle_closed_by_name || null,
      nextCycle: raw.nextCycle,
    },
    reconciliation: { status: failed.length ? "FAILED" : "PASSED", checks },
  };
}

async function loadRawReport(client, user, groupId, cycleId) {
  const metadata = await repository.cycleMetadata(client, user.organization_id, groupId, cycleId);
  if (!metadata) throw new NotFoundError("Cycle report not found");
  const participants = await repository.participants(client, groupId, cycleId);
  const officers = await repository.officers(client, groupId, cycleId);
  const meetings = await repository.meetings(client, groupId, cycleId);
  const attendance = await repository.attendance(client, groupId, cycleId);
  const savingsTransactions = await repository.savingsTransactions(client, groupId, cycleId);
  const socialFundTransactions = await repository.socialFundTransactions(client, groupId, cycleId);
  const fineTransactions = await repository.fineTransactions(client, groupId, cycleId);
  const loans = await repository.loans(client, groupId, cycleId);
  const loanTransactions = await repository.loanTransactions(client, groupId, cycleId);
  const cashbook = await repository.cashbook(client, groupId, cycleId);
  const accountBalances = await repository.accountBalances(client, groupId, cycleId);
  const socialFundTransfers = await repository.socialFundTransfers(client, groupId, cycleId);
  const reconciliations = await repository.reconciliations(client, groupId, cycleId);
  const shareout = await getShareout(groupId, cycleId, null, client);
  const nextCycle = await repository.nextCycle(client, groupId, metadata.cycle_number);
  return { metadata, participants, officers, meetings, attendance, savingsTransactions, socialFundTransactions, fineTransactions, loans, loanTransactions, cashbook, accountBalances, socialFundTransfers, reconciliations, shareout, nextCycle };
}

export async function getCycleReportWithClient(user, groupId, cycleId, client, access = "view") {
  await assertCycleReportAccess(user, groupId, client, access);
  const raw = await loadRawReport(client, user, groupId, cycleId);
  return assembleCycleReport(raw, { user });
}

export async function getCycleReport(user, groupId, cycleId, access = "view") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const report = await getCycleReportWithClient(user, groupId, cycleId, client, access);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export { REPORT_STATUSES };
