import { pool } from "@/lib/db/pool";
import { AppError, NotFoundError } from "@/lib/errors";
import { assertCycleReportAccess, assembleFines, cents, integrityCheck, money, sumMoney, transactionSign } from "./cycle-report.service";
import * as cycleRepository from "./cycle-report.repository";
import * as repository from "./meeting-report.repository";

const MEETING_REPORT_STATUSES = Object.freeze({ OPEN: "IN PROGRESS", CLOSED: "FINAL", CANCELLED: "CANCELLED" });
const isoDateTime = (value) => value ? new Date(value).toISOString() : null;

function aggregateMemberTransactions(transactions, positiveKind, amountName, shareField = null) {
  const members = new Map();
  for (const transaction of transactions) {
    const row = members.get(transaction.member_id) || {
      memberId: transaction.member_id,
      memberCode: transaction.member_code,
      memberName: transaction.member_name,
      positiveAmount: 0,
      reversalAmount: 0,
      positiveShares: 0,
      reversalShares: 0,
      transactionTypes: new Set(),
    };
    const sign = transactionSign(transaction.transaction_kind, positiveKind);
    if (sign > 0) {
      row.positiveAmount += cents(transaction.amount);
      if (shareField) row.positiveShares += Number(transaction[shareField] || 0);
    } else if (sign < 0) {
      row.reversalAmount += cents(transaction.amount);
      if (shareField) row.reversalShares += Number(transaction[shareField] || 0);
    }
    row.transactionTypes.add(transaction.transaction_kind);
    members.set(transaction.member_id, row);
  }
  return [...members.values()].map((row) => ({
    memberId: row.memberId,
    memberCode: row.memberCode,
    memberName: row.memberName,
    [amountName]: money(row.positiveAmount),
    reversal: money(row.reversalAmount),
    netAmount: money(row.positiveAmount - row.reversalAmount),
    ...(shareField ? {
      sharesPurchased: row.positiveShares,
      sharesReversed: row.reversalShares,
      netShares: row.positiveShares - row.reversalShares,
    } : {}),
    transactionTypes: [...row.transactionTypes],
  }));
}

function assembleAttendance(participants) {
  const rows = participants.map((participant) => ({
    memberId: participant.member_id,
    memberCode: participant.member_code,
    memberName: participant.member_name,
    status: participant.attendance_status,
    notes: participant.attendance_notes,
    recordedAt: isoDateTime(participant.recorded_at),
    recordedBy: participant.recorded_by_name || null,
  }));
  const count = (status) => rows.filter((row) => row.status === status).length;
  return {
    rows,
    totals: {
      eligible: rows.length,
      present: count("PRESENT"),
      absent: count("ABSENT"),
      late: count("LATE"),
      excused: count("EXCUSED"),
      unmarked: count("UNMARKED"),
    },
  };
}

function assembleSavings(transactions) {
  const rows = aggregateMemberTransactions(transactions, "PURCHASE", "purchases", "shares");
  return {
    rows: rows.map((row) => ({ ...row, netSavings: row.netAmount })),
    total: sumMoney(rows, (row) => row.netAmount),
  };
}

function assembleSocialFund(transactions) {
  const rows = aggregateMemberTransactions(transactions, "CONTRIBUTION", "contribution");
  return {
    rows: rows.map((row) => ({ ...row, netContribution: row.netAmount })),
    total: sumMoney(rows, (row) => row.netAmount),
    payouts: null,
  };
}

function assembleLoanRequests(rows, meetingId) {
  return rows.map((row) => ({
    id: row.id,
    requestCode: row.request_code,
    borrower: row.borrower_name,
    memberCode: row.member_code,
    purpose: row.purpose,
    requestedAmount: money(cents(row.requested_principal)),
    approvedAmount: row.approved_principal === null ? null : money(cents(row.approved_principal)),
    requestedTermMonths: row.requested_term_months,
    approvedTermMonths: row.approved_term_months,
    status: row.report_status,
    requestedBy: row.requested_by_name,
    requestedAt: isoDateTime(row.requested_at),
    decidedBy: row.decision_meeting_id === meetingId ? row.decided_by_name || null : null,
    decidedAt: row.decision_meeting_id === meetingId ? isoDateTime(row.decided_at) : null,
    requestedThisMeeting: row.request_meeting_id === meetingId,
    decidedThisMeeting: row.decision_meeting_id === meetingId,
  }));
}

function assembleLoans(rows) {
  return rows.map((row) => ({
    id: row.id,
    loanCode: row.loan_code,
    borrower: row.borrower_name,
    memberCode: row.member_code,
    purpose: row.purpose,
    principal: money(cents(row.principal_disbursed)),
    serviceChargeRate: Number(row.service_charge_rate),
    serviceCharge: money(cents(row.service_charge_total_due)),
    totalDue: money(cents(row.total_contractual_due)),
    termMonths: row.term_months,
    disbursementDate: row.disbursement_date,
    dueDate: row.due_date,
    disbursedBy: row.disbursed_by_name,
    status: row.status_at_meeting,
  }));
}

function assembleRepayments(rows) {
  const details = rows.map((row) => {
    const sign = transactionSign(row.transaction_kind, "PAYMENT");
    return {
      id: row.id,
      borrower: row.borrower_name,
      memberCode: row.member_code,
      loanId: row.loan_id,
      loanCode: row.loan_code,
      reference: row.reference_code,
      transactionType: row.transaction_kind,
      date: row.effective_date,
      amountPaid: money(sign * cents(row.payment_amount)),
      principalComponent: money(sign * cents(row.principal_component)),
      serviceChargeComponent: money(sign * cents(row.service_charge_component)),
      remainingBalance: null,
      recordedBy: row.recorded_by_name,
    };
  });
  return {
    rows: details,
    totals: {
      repayments: sumMoney(details, (row) => row.amountPaid),
      principalRepaid: sumMoney(details, (row) => row.principalComponent),
      serviceChargeCollected: sumMoney(details, (row) => row.serviceChargeComponent),
    },
  };
}

function assembleReconciliation(row) {
  if (!row) return { status: "NOT YET RECONCILED", available: false, signatureRecorded: false };
  return {
    available: true,
    id: row.id,
    expectedCash: money(cents(row.expected_savings_loan_balance) + cents(row.expected_social_fund_balance)),
    actualCash: money(cents(row.counted_savings_loan_balance) + cents(row.counted_social_fund_balance)),
    variance: money(cents(row.savings_loan_difference) + cents(row.social_fund_difference)),
    status: row.status,
    savingsLoanFund: {
      expected: row.expected_savings_loan_balance,
      actual: row.counted_savings_loan_balance,
      variance: row.savings_loan_difference,
    },
    socialFund: {
      expected: row.expected_social_fund_balance,
      actual: row.counted_social_fund_balance,
      variance: row.social_fund_difference,
    },
    notes: row.notes,
    reconciledBy: row.reconciled_by_name,
    reconciledAt: isoDateTime(row.created_at),
    signatureRecorded: Boolean(row.signature_recorded),
  };
}

export function assembleMeetingReport(raw, { user, generatedAt = new Date().toISOString() }) {
  if (!raw.metadata) throw new NotFoundError("Meeting report not found");
  const attendance = assembleAttendance(raw.participants);
  const savings = assembleSavings(raw.savingsTransactions);
  const socialFund = assembleSocialFund(raw.socialFundTransactions);
  const fines = assembleFines(raw.fineTransactions);
  const loanRequests = assembleLoanRequests(raw.loanRequests, raw.metadata.meeting_id);
  const loans = assembleLoans(raw.loans);
  const loanRepayments = assembleRepayments(raw.repayments);
  const reconciliation = assembleReconciliation(raw.reconciliation);
  const summary = {
    meetingNumber: raw.metadata.meeting_number,
    meetingDate: raw.metadata.meeting_date,
    meetingStatus: raw.metadata.meeting_status,
    eligibleParticipants: attendance.totals.eligible,
    present: attendance.totals.present,
    absent: attendance.totals.absent,
    late: attendance.totals.late,
    excused: attendance.totals.excused,
    netSavings: raw.totals.net_savings,
    socialFundContributions: raw.totals.social_fund_contributions,
    finesAssessed: raw.totals.fines_assessed,
    finesCollected: raw.totals.fines_collected,
    loanRequests: raw.totals.loan_requests,
    loansApproved: raw.totals.loans_approved,
    loansRejected: raw.totals.loans_rejected,
    loansDisbursed: raw.totals.loans_disbursed,
    loanPrincipalDisbursed: raw.totals.loan_principal_disbursed,
    loanRepayments: raw.totals.loan_repayments,
    principalRepaid: raw.totals.principal_repaid,
    serviceChargeCollected: raw.totals.service_charge_collected,
    reconciliationStatus: reconciliation.status,
  };
  const checks = [
    integrityCheck("Savings", savings.total, summary.netSavings),
    integrityCheck("Social Fund contributions", socialFund.total, summary.socialFundContributions),
    integrityCheck("Fines collected", fines.totals.collected, summary.finesCollected),
    integrityCheck("Loan principal disbursed", sumMoney(loans, (loan) => loan.principal), summary.loanPrincipalDisbursed),
    integrityCheck("Loan repayments", loanRepayments.totals.repayments, summary.loanRepayments),
  ];
  const failed = checks.filter((check) => !check.passed);
  if (raw.metadata.meeting_status === "CLOSED" && failed.length) {
    throw new AppError("Closed meeting report totals do not reconcile", "MEETING_REPORT_RECONCILIATION_FAILED", 409, { checks: failed });
  }
  return {
    metadata: {
      productName: "Visave",
      groupId: raw.metadata.group_id,
      groupName: raw.metadata.group_name,
      groupCode: raw.metadata.group_code,
      state: raw.metadata.state_name,
      lga: raw.metadata.lga_name,
      community: raw.metadata.community_name,
      operationMode: raw.metadata.operation_mode,
      cycleId: raw.metadata.cycle_id,
      cycleNumber: raw.metadata.cycle_number,
      cycleStatus: raw.metadata.cycle_status,
      meetingId: raw.metadata.meeting_id,
      meetingNumber: raw.metadata.meeting_number,
      meetingCode: raw.metadata.meeting_code,
      meetingDate: raw.metadata.meeting_date,
      meetingStatus: raw.metadata.meeting_status,
      reportStatus: MEETING_REPORT_STATUSES[raw.metadata.meeting_status],
      openedAt: isoDateTime(raw.metadata.opened_at),
      openedBy: raw.metadata.opened_by_name,
      closedAt: isoDateTime(raw.metadata.closed_at),
      closedBy: raw.metadata.closed_by_name || null,
      cancelledAt: isoDateTime(raw.metadata.cancelled_at),
      cancelledBy: raw.metadata.cancelled_by_name || null,
      cancellationReason: raw.metadata.cancellation_reason,
      officers: raw.officers,
      generatedAt,
      generatedBy: { id: user.id, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), email: user.email || null },
    },
    meetingSummary: summary,
    attendance,
    savings,
    socialFund,
    fines,
    loanRequests,
    loans,
    loanRepayments,
    reconciliation,
    integrity: { status: failed.length ? "FAILED" : "PASSED", checks },
  };
}

async function loadRawReport(client, user, groupId, cycleId, meetingId) {
  const metadata = await repository.meetingMetadata(client, user.organization_id, groupId, cycleId, meetingId);
  if (!metadata) throw new NotFoundError("Meeting report not found");
  const officers = await cycleRepository.officers(client, groupId, cycleId);
  const participants = await repository.meetingParticipants(client, groupId, cycleId, meetingId);
  const savingsTransactions = await repository.meetingSavings(client, groupId, cycleId, meetingId);
  const socialFundTransactions = await repository.meetingSocialFund(client, groupId, cycleId, meetingId);
  const fineTransactions = await repository.meetingFines(client, groupId, cycleId, meetingId);
  const loanRequests = await repository.meetingLoanRequests(client, groupId, cycleId, meetingId);
  const loans = await repository.meetingLoans(client, groupId, cycleId, meetingId);
  const repayments = await repository.meetingRepayments(client, groupId, cycleId, meetingId);
  const reconciliation = await repository.meetingReconciliation(client, groupId, cycleId, meetingId);
  const totals = await repository.meetingTotals(client, groupId, cycleId, meetingId);
  return { metadata, officers, participants, savingsTransactions, socialFundTransactions, fineTransactions, loanRequests, loans, repayments, reconciliation, totals };
}

export async function getMeetingReportWithClient(user, groupId, cycleId, meetingId, client, access = "view") {
  await assertCycleReportAccess(user, groupId, client, access);
  return assembleMeetingReport(await loadRawReport(client, user, groupId, cycleId, meetingId), { user });
}

export async function getMeetingReport(user, groupId, cycleId, meetingId, access = "view") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const report = await getMeetingReportWithClient(user, groupId, cycleId, meetingId, client, access);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export { MEETING_REPORT_STATUSES };
