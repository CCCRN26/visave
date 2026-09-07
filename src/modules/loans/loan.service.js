import crypto from "node:crypto";
import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { lockContext, balances } from "@/modules/meetings/meeting.repository";
import {
  existingLoanFinancial,
  postLoanFinancial,
  reverseLoanFinancial,
} from "@/modules/meetings/financial.service";
import * as repo from "./loan.repository";
import { assertGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { requireEffectiveCycleMembership } from "@/modules/cycle-participation/cycle-participation.service";
const ref = (p) =>
  `${p}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const domain = (code, message, status = 409, details) =>
  new AppError(message, code, status, details);
async function meeting(c, g, m) {
  const x = await lockContext(c, g, m);
  if (!x) throw new NotFoundError("Meeting not found");
  if (
    x.status !== "OPEN" ||
    x.group_status !== "ACTIVE" ||
    x.cycle_status !== "ACTIVE"
  )
    throw new ConflictError(
      "Loan operations require an open meeting in an active group and cycle",
    );
  return x;
}
async function eligible(c, ctx, memberId) {
  await requireEffectiveCycleMembership(c,{groupId:ctx.group_id,cycleId:ctx.cycle_id,memberId,effectiveDate:ctx.meeting_date});
  const e = await repo.eligibility(c, ctx.cycle_id, memberId);
  if (!e || e.status !== "ACTIVE")
    throw new ValidationError(
      "Borrower must be an active member of this group",
    );
  return e;
}
function assertSameCycle(ctx, entity, label) {
  if (
    entity.group_id !== ctx.group_id ||
    entity.cycle_id !== ctx.cycle_id ||
    entity.organization_id !== ctx.organization_id
  )
    throw domain(
      "LOAN_CONTEXT_MISMATCH",
      `${label} does not belong to this group, organization, and active cycle`,
    );
}
function assertCompleteTerms(terms) {
  if (
    terms.loan_max_multiple == null ||
    terms.loan_service_charge_rate == null ||
    terms.loan_max_term_months == null
  )
    throw domain(
      "LOAN_TERMS_INCOMPLETE",
      "The active Constitution has incomplete lending terms",
      400,
    );
}
async function assertPresent(c, meetingId, memberId) {
  const row = (
    await c.query(
      `SELECT attendance_status FROM meeting_attendance
       WHERE meeting_id=$1 AND member_id=$2 FOR UPDATE`,
      [meetingId, memberId],
    )
  ).rows[0];
  if (row?.attendance_status !== "PRESENT")
    throw domain(
      "BORROWER_NOT_PRESENT",
      "Borrower must be marked PRESENT at this meeting",
      400,
    );
  return row.attendance_status;
}
async function noOutstanding(c, cycleId, memberId) {
  if (
    (
      await c.query(
        `SELECT 1 FROM loans WHERE cycle_id=$1 AND member_id=$2 AND settled_at IS NULL AND voided_at IS NULL`,
        [cycleId, memberId],
      )
    ).rowCount
  )
    throw new ConflictError("Member already has an outstanding loan");
}
async function noOpenRequest(c, cycleId, memberId) {
  if (
    (
      await c.query(
        `SELECT 1 FROM loan_requests
         WHERE cycle_id=$1 AND member_id=$2 AND status IN ('PENDING','APPROVED')`,
        [cycleId, memberId],
      )
    ).rowCount
  )
    throw domain(
      "LOAN_REQUEST_ALREADY_OPEN",
      "Member already has a pending or approved loan request",
    );
}
export async function listLoans(groupId) {
  return {
    requests: await repo.listRequests(pool, groupId),
    loans: await repo.loanProjection(pool, groupId),
  };
}
export async function getLoan(groupId, id) {
  const loan = (await repo.loanProjection(pool, groupId, id))[0];
  if (!loan) throw new NotFoundError("Loan not found");
  const repayments = (
    await pool.query(
      `SELECT p.*,t.reference_code,t.created_at transaction_at FROM loan_repayments p JOIN financial_transactions t ON t.id=p.financial_transaction_id WHERE p.loan_id=$1 ORDER BY p.created_at`,
      [id],
    )
  ).rows;
  return { loan, repayments };
}
export async function getEligibility(groupId, meetingId, memberId) {
  return withTransaction(async (c) => {
    const ctx = await meeting(c, groupId, meetingId);
    const result = await eligible(c, ctx, memberId);
    const attendance = (
      await c.query(
        "SELECT attendance_status FROM meeting_attendance WHERE meeting_id=$1 AND member_id=$2",
        [meetingId, memberId],
      )
    ).rows[0];
    return { ...result, attendance_status: attendance?.attendance_status || null };
  });
}
export async function requestLoan(groupId, meetingId, data, user) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_REQUEST, c);
    const ctx = await meeting(c, groupId, meetingId),
      e = await eligible(c, ctx, data.memberId);
    await noOutstanding(c, ctx.cycle_id, data.memberId);
    await noOpenRequest(c, ctx.cycle_id, data.memberId);
    await assertPresent(c, ctx.id, data.memberId);
    assertCompleteTerms(e);
    if (data.requestedTermMonths > e.loan_max_term_months)
      throw new ValidationError("Requested term exceeds constitution maximum");
    const allowed = (
      await c.query("SELECT $1::numeric<=$2::numeric ok", [
        data.requestedPrincipal,
        e.maximum_eligible,
      ])
    ).rows[0].ok;
    if (!allowed)
      throw new ValidationError(
        "Requested amount exceeds current loan eligibility",
      );
    let r;
    try {
      r = (
        await c.query(
        `INSERT INTO loan_requests(organization_id,group_id,cycle_id,member_id,request_meeting_id,request_code,requested_principal,requested_term_months,purpose,savings_snapshot,maximum_eligible_snapshot,status,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',$12) RETURNING *`,
        [
          ctx.organization_id,
          ctx.group_id,
          ctx.cycle_id,
          data.memberId,
          ctx.id,
          ref("LRQ"),
          data.requestedPrincipal,
          data.requestedTermMonths,
          data.purpose || null,
          e.net_savings,
          e.maximum_eligible,
          user.id,
        ],
        )
      ).rows[0];
    } catch (error) {
      if (error.code === "23505" && error.constraint === "one_unresolved_loan_request_per_member_cycle")
        throw domain(
          "LOAN_REQUEST_ALREADY_OPEN",
          "Member already has a pending or approved loan request",
        );
      throw error;
    }
    await writeAudit(c, {
      organizationId: ctx.organization_id,
      actorUserId: user.id,
      action: "LOAN_REQUESTED",
      entityType: "LOAN_REQUEST",
      entityId: r.id,
      newValues: r,
    });
    return r;
  });
}
export async function decideLoan(
  groupId,
  meetingId,
  requestId,
  data,
  user,
  decision,
) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_DECIDE, c);
    const ctx = await meeting(c, groupId, meetingId),
      r = (
        await c.query(
          `SELECT * FROM loan_requests WHERE id=$1 AND group_id=$2 FOR UPDATE`,
          [requestId, groupId],
        )
      ).rows[0];
    if (!r) throw new NotFoundError("Loan request not found");
    assertSameCycle(ctx, r, "Loan request");
    if (r.status !== "PENDING")
      throw new ConflictError("Loan request is not pending");
    if (r.requested_by === user.id)
      throw domain(
        "LOAN_SEPARATION_OF_DUTIES_VIOLATION",
        "The request recorder cannot approve or reject this request",
        403,
      );
    const e = await eligible(c, ctx, r.member_id);
    let principal = null,
      term = null;
    if (decision === "APPROVED") {
      assertCompleteTerms(e);
      await noOutstanding(c, ctx.cycle_id, r.member_id);
      principal = data.approvedPrincipal;
      term = data.approvedTermMonths;
      const v = (
        await c.query(
          `SELECT $1::numeric<=$2::numeric AND $1::numeric<=$3::numeric amount_ok,$4::int<=$5::int term_ok`,
          [
            principal,
            r.requested_principal,
            e.maximum_eligible,
            term,
            e.loan_max_term_months,
          ],
        )
      ).rows[0];
      if (!v.amount_ok)
        throw new ValidationError(
          "Approved principal exceeds request or eligibility",
        );
      if (!v.term_ok)
        throw new ValidationError(
          "Approved term exceeds Constitution maximum",
        );
    }
    const d = (
      await c.query(
        `INSERT INTO loan_decisions(loan_request_id,organization_id,group_id,cycle_id,member_id,decision_meeting_id,decision,approved_principal,approved_term_months,savings_snapshot,maximum_eligible_snapshot,notes,decided_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          r.id,
          ctx.organization_id,
          ctx.group_id,
          ctx.cycle_id,
          r.member_id,
          ctx.id,
          decision,
          principal,
          term,
          e.net_savings,
          e.maximum_eligible,
          data.notes || null,
          user.id,
        ],
      )
    ).rows[0];
    await c.query(
      `UPDATE loan_requests SET status=$2,updated_at=now() WHERE id=$1`,
      [r.id, decision],
    );
    await writeAudit(c, {
      organizationId: ctx.organization_id,
      actorUserId: user.id,
      action: `LOAN_${decision}`,
      entityType: "LOAN_REQUEST",
      entityId: r.id,
      newValues: d,
    });
    return d;
  });
}
export async function cancelRequest(groupId, meetingId, requestId, data, user) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_REQUEST, c);
    const ctx = await meeting(c, groupId, meetingId),
      existing = (
        await c.query(
          `SELECT * FROM loan_requests WHERE id=$1 AND group_id=$2 FOR UPDATE`,
          [requestId, groupId],
        )
      ).rows[0];
    if (!existing) throw new NotFoundError("Loan request not found");
    assertSameCycle(ctx, existing, "Loan request");
    const r = (
        await c.query(
          `UPDATE loan_requests SET status='CANCELLED',cancelled_by=$3,cancelled_at=now(),cancellation_reason=$4,updated_at=now() WHERE id=$1 AND group_id=$2 AND status='PENDING' RETURNING *`,
          [requestId, groupId, user.id, data.reason],
        )
      ).rows[0];
    if (!r) throw new ConflictError("Only a pending request can be cancelled");
    await writeAudit(c, {
      organizationId: ctx.organization_id,
      actorUserId: user.id,
      action: "LOAN_REQUEST_CANCELLED",
      entityType: "LOAN_REQUEST",
      entityId: r.id,
      newValues: r,
    });
    return r;
  });
}
export async function disburse(groupId, meetingId, requestId, data, user) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_DISBURSE, c);
    const ctx = await meeting(c, groupId, meetingId),
      r = (
        await c.query(
          `SELECT r.*,d.id decision_id,d.approved_principal,d.approved_term_months,d.decided_by FROM loan_requests r JOIN loan_decisions d ON d.loan_request_id=r.id AND d.decision='APPROVED' AND d.organization_id=r.organization_id AND d.group_id=r.group_id AND d.cycle_id=r.cycle_id AND d.member_id=r.member_id WHERE r.id=$1 AND r.group_id=$2 FOR UPDATE OF r,d`,
          [requestId, groupId],
        )
      ).rows[0];
    if (!r || r.status !== "APPROVED")
      throw new ConflictError("Loan request is not approved");
    assertSameCycle(ctx, r, "Loan request");
    if (r.decided_by === user.id)
      throw domain(
        "LOAN_SEPARATION_OF_DUTIES_VIOLATION",
        "The loan approver cannot record its disbursement",
        403,
      );
    const e = await eligible(c, ctx, r.member_id);
    assertCompleteTerms(e);
    await noOutstanding(c, ctx.cycle_id, r.member_id);
    if (
      !(
        await c.query("SELECT $1::numeric<=$2::numeric ok", [
          r.approved_principal,
          e.maximum_eligible,
        ])
      ).rows[0].ok
    )
      throw new ValidationError(
        "Approved principal now exceeds current eligibility",
      );
    const b = await balances(c, ctx.cycle_id);
    if (
      !(
        await c.query("SELECT $1::numeric<=$2::numeric ok", [
          r.approved_principal,
          b.savings_loan,
        ])
      ).rows[0].ok
    )
      throw new ConflictError(
        "Insufficient Savings/Loan cash for disbursement",
      );
    const posted = await postLoanFinancial(
      c,
      ctx,
      {
        type: "LOAN_DISBURSEMENT",
        memberId: r.member_id,
        idempotencyKey: data.idempotencyKey,
        payload: { requestId },
        lines: [
          {
            account: "LOANS_RECEIVABLE",
            side: "DEBIT",
            amount: r.approved_principal,
          },
          {
            account: "SAVINGS_LOAN_CASH",
            side: "CREDIT",
            amount: r.approved_principal,
          },
        ],
      },
      user,
    );
    if (posted.idempotent) {
      const existing = (
        await c.query(
          "SELECT * FROM loans WHERE disbursement_financial_transaction_id=$1",
          [posted.transaction.id],
        )
      ).rows[0];
      return {
        loan: existing,
        transaction: posted.transaction,
        idempotent: true,
      };
    }
    const calc = (
        await c.query(
          `SELECT ($1::numeric*($2::numeric/100)*$3::int)::numeric(18,2) charge,($1::numeric+($1::numeric*($2::numeric/100)*$3::int))::numeric(18,2) total,($4::date+make_interval(months=>$3::int))::date due`,
          [
            r.approved_principal,
            e.loan_service_charge_rate,
            r.approved_term_months,
            ctx.meeting_date,
          ],
        )
      ).rows[0],
      loan = (
        await c.query(
          `INSERT INTO loans(organization_id,group_id,cycle_id,member_id,loan_request_id,loan_decision_id,constitution_id,loan_code,disbursement_meeting_id,disbursement_financial_transaction_id,principal_disbursed,service_charge_rate,term_months,service_charge_total_due,total_contractual_due,disbursement_date,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            ctx.organization_id,
            ctx.group_id,
            ctx.cycle_id,
            r.member_id,
            r.id,
            r.decision_id,
            e.constitution_id,
            ref("LOAN"),
            ctx.id,
            posted.transaction.id,
            r.approved_principal,
            e.loan_service_charge_rate,
            r.approved_term_months,
            calc.charge,
            calc.total,
            ctx.meeting_date,
            calc.due,
            user.id,
          ],
        )
      ).rows[0];
    await c.query(
      `UPDATE loan_requests SET status='DISBURSED',updated_at=now() WHERE id=$1`,
      [r.id],
    );
    await writeAudit(c, {
      organizationId: ctx.organization_id,
      actorUserId: user.id,
      action: "LOAN_DISBURSED",
      entityType: "LOAN",
      entityId: loan.id,
      newValues: loan,
    });
    return { loan, transaction: posted.transaction, idempotent: false };
  });
}
export async function repay(groupId, meetingId, loanId, data, user) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_REPAY, c);
    const ctx = await meeting(c, groupId, meetingId),
      loan = (
        await c.query(
          `SELECT * FROM loans WHERE id=$1 AND group_id=$2 FOR UPDATE`,
          [loanId, groupId],
        )
      ).rows[0];
    if (!loan) throw new NotFoundError("Loan not found");
    assertSameCycle(ctx, loan, "Loan");
    if (loan.voided_at || loan.settled_at)
      throw new ConflictError("Loan is not outstanding");
    const projection = (await repo.loanProjection(c, groupId, loanId))[0],
      allocation = (
        await c.query(
          `SELECT LEAST($1::numeric,$2::numeric)::numeric(18,2) charge,($1::numeric-LEAST($1::numeric,$2::numeric))::numeric(18,2) principal,$1::numeric<=$3::numeric ok`,
          [
            data.paymentAmount,
            projection.service_charge_remaining,
            projection.total_outstanding,
          ],
        )
      ).rows[0];
    if (!allocation.ok)
      throw new ValidationError("Payment exceeds total outstanding obligation");
    const lines = [
      {
        account: "SAVINGS_LOAN_CASH",
        side: "DEBIT",
        amount: data.paymentAmount,
      },
    ];
    if (allocation.charge !== "0.00")
      lines.push({
        account: "LOAN_SERVICE_CHARGE_INCOME",
        side: "CREDIT",
        amount: allocation.charge,
      });
    if (allocation.principal !== "0.00")
      lines.push({
        account: "LOANS_RECEIVABLE",
        side: "CREDIT",
        amount: allocation.principal,
      });
    const posted = await postLoanFinancial(
      c,
      ctx,
      {
        type: "LOAN_REPAYMENT",
        memberId: loan.member_id,
        idempotencyKey: data.idempotencyKey,
        payload: { loanId, paymentAmount: data.paymentAmount },
        lines,
      },
      user,
    );
    if (posted.idempotent)
      return { transaction: posted.transaction, idempotent: true };
    const p = (
        await c.query(
          `INSERT INTO loan_repayments(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,loan_id,member_id,transaction_kind,payment_amount,principal_component,service_charge_component,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'PAYMENT',$8,$9,$10,$11) RETURNING *`,
          [
            posted.transaction.id,
            ctx.organization_id,
            ctx.group_id,
            ctx.cycle_id,
            ctx.id,
            loan.id,
            loan.member_id,
            data.paymentAmount,
            allocation.principal,
            allocation.charge,
            user.id,
          ],
        )
      ).rows[0],
      remaining = (
        await c.query(`SELECT ($1::numeric-$2::numeric)=0 settled`, [
          projection.total_outstanding,
          data.paymentAmount,
        ])
      ).rows[0].settled;
    if (remaining)
      await c.query("UPDATE loans SET settled_at=now() WHERE id=$1", [loan.id]);
    await writeAudit(c, {
      organizationId: ctx.organization_id,
      actorUserId: user.id,
      action: "LOAN_REPAYMENT_RECORDED",
      entityType: "LOAN_REPAYMENT",
      entityId: p.id,
      newValues: p,
    });
    return { repayment: p, transaction: posted.transaction, idempotent: false };
  });
}
export async function reverseLoan(
  groupId,
  meetingId,
  loanId,
  transactionId,
  data,
  user,
) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_OPERATE, c);
    const ctx = await meeting(c, groupId, meetingId),
      loan = (
        await c.query(
          `SELECT * FROM loans WHERE id=$1 AND group_id=$2 FOR UPDATE`,
          [loanId, groupId],
        )
      ).rows[0],
      original = (
        await c.query(
          `SELECT * FROM financial_transactions WHERE id=$1 AND meeting_id=$2 AND member_id=$3 FOR UPDATE`,
          [transactionId, ctx.id, loan?.member_id],
        )
      ).rows[0];
    if (!loan || !original)
      throw new NotFoundError("Loan transaction not found");
    assertSameCycle(ctx, loan, "Loan");
    if (
      original.group_id !== loan.group_id ||
      original.cycle_id !== loan.cycle_id ||
      original.member_id !== loan.member_id
    )
      throw domain("LOAN_CONTEXT_MISMATCH", "Loan transaction context is invalid");
    if (
      original.transaction_type === "LOAN_DISBURSEMENT" &&
      (
        await c.query(
          `SELECT 1 FROM loan_repayments p JOIN financial_transactions t ON t.id=p.financial_transaction_id WHERE p.loan_id=$1 AND p.transaction_kind='PAYMENT' AND NOT EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id)`,
          [loan.id],
        )
      ).rowCount
    )
      throw new ConflictError(
        "Disbursement cannot be reversed after a repayment",
      );
    const posted = await reverseLoanFinancial(
      c,
      ctx,
      original,
      data.idempotencyKey,
      user,
    );
    if (posted.idempotent) return posted;
    if (original.transaction_type === "LOAN_REPAYMENT") {
      const p = (
        await c.query(
          "SELECT * FROM loan_repayments WHERE financial_transaction_id=$1",
          [original.id],
        )
      ).rows[0];
      const later = (
        await c.query(
          `SELECT 1 FROM loan_repayments later
           JOIN financial_transactions later_tx ON later_tx.id=later.financial_transaction_id
           WHERE later.loan_id=$1 AND later.transaction_kind='PAYMENT'
             AND (later.created_at,later.id)>(($2::timestamptz),$3::uuid)
             AND NOT EXISTS(
               SELECT 1 FROM financial_transactions reversal
               WHERE reversal.reversal_of_transaction_id=later_tx.id
             )
           FOR UPDATE OF later`,
          [loan.id, p.created_at, p.id],
        )
      ).rowCount;
      if (later)
        throw domain(
          "LOAN_REPAYMENT_REVERSAL_ORDER_INVALID",
          "Only the latest active repayment may be reversed",
        );
      await c.query(
        `INSERT INTO loan_repayments(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,loan_id,member_id,transaction_kind,payment_amount,principal_component,service_charge_component,original_loan_repayment_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'REVERSAL',$8,$9,$10,$11,$12)`,
        [
          posted.transaction.id,
          p.organization_id,
          p.group_id,
          p.cycle_id,
          p.meeting_id,
          p.loan_id,
          p.member_id,
          p.payment_amount,
          p.principal_component,
          p.service_charge_component,
          p.id,
          user.id,
        ],
      );
      await c.query("UPDATE loans SET settled_at=NULL WHERE id=$1", [loan.id]);
      await writeAudit(c, {
        organizationId: ctx.organization_id,
        actorUserId: user.id,
        action: "LOAN_REPAYMENT_REVERSED",
        entityType: "LOAN",
        entityId: loan.id,
        newValues: { transactionId: posted.transaction.id },
      });
    } else if (original.transaction_type === "LOAN_DISBURSEMENT") {
      await c.query("UPDATE loans SET voided_at=now() WHERE id=$1", [loan.id]);
      await writeAudit(c, {
        organizationId: ctx.organization_id,
        actorUserId: user.id,
        action: "LOAN_DISBURSEMENT_REVERSED",
        entityType: "LOAN",
        entityId: loan.id,
        newValues: { transactionId: posted.transaction.id },
      });
    } else
      throw new ValidationError(
        "Transaction is not a reversible loan transaction",
      );
    return posted;
  });
}
export async function markDefault(groupId, loanId, data, user) {
  return withTransaction(async (c) => {
    await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_OPERATE, c);
    const loan = (
      await c.query(
        `SELECT * FROM loans WHERE id=$1 AND group_id=$2 FOR UPDATE`,
        [loanId, groupId],
      )
    ).rows[0];
    if (!loan) throw new NotFoundError("Loan not found");
    const cycle = (
      await c.query("SELECT status FROM vsla_cycles WHERE id=$1 FOR UPDATE", [
        loan.cycle_id,
      ])
    ).rows[0];
    if (cycle?.status !== "ACTIVE")
      throw new ConflictError("Loans cannot be changed while the cycle is closing or closed");
    const p = (await repo.loanProjection(c, groupId, loanId))[0];
    if (p.display_status !== "OVERDUE")
      throw new ConflictError(
        "Only an overdue outstanding loan can be defaulted",
      );
    const x = (
      await c.query(
        `UPDATE loans SET defaulted_at=now(),defaulted_by=$2,default_reason=$3 WHERE id=$1 RETURNING *`,
        [loan.id, user.id, data.reason],
      )
    ).rows[0];
    await writeAudit(c, {
      organizationId: loan.organization_id,
      actorUserId: user.id,
      action: "LOAN_MARKED_DEFAULTED",
      entityType: "LOAN",
      entityId: loan.id,
      newValues: x,
    });
    return x;
  });
}

async function priorDisbursement(groupId, meetingId, requestId, data) {
  return withTransaction(async (c) => {
    const ctx = await meeting(c, groupId, meetingId),
      transaction = await existingLoanFinancial(c, ctx, {
        type: "LOAN_DISBURSEMENT",
        idempotencyKey: data.idempotencyKey,
        payload: { requestId },
      });
    if (!transaction) return null;
    const loan = (
      await c.query(
        `SELECT * FROM loans WHERE disbursement_financial_transaction_id=$1 AND group_id=$2 AND disbursement_meeting_id=$3 AND loan_request_id=$4`,
        [transaction.id, groupId, meetingId, requestId],
      )
    ).rows[0];
    if (!loan)
      throw new ConflictError(
        "Idempotency record does not match this loan disbursement",
      );
    return { loan, transaction, idempotent: true };
  });
}
export async function disburseIdempotent(
  groupId,
  meetingId,
  requestId,
  data,
  user,
) {
  await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_DISBURSE, pool);
  const prior = await priorDisbursement(groupId, meetingId, requestId, data);
  if (prior) return prior;
  try {
    return await disburse(groupId, meetingId, requestId, data, user);
  } catch (error) {
    const committed = await priorDisbursement(
      groupId,
      meetingId,
      requestId,
      data,
    );
    if (committed) return committed;
    throw error;
  }
}
async function priorRepayment(groupId, meetingId, loanId, data) {
  return withTransaction(async (c) => {
    const ctx = await meeting(c, groupId, meetingId),
      transaction = await existingLoanFinancial(c, ctx, {
        type: "LOAN_REPAYMENT",
        idempotencyKey: data.idempotencyKey,
        payload: { loanId, paymentAmount: data.paymentAmount },
      });
    if (!transaction) return null;
    const repayment = (
      await c.query(
        `SELECT * FROM loan_repayments WHERE financial_transaction_id=$1 AND group_id=$2 AND meeting_id=$3 AND loan_id=$4 AND transaction_kind='PAYMENT'`,
        [transaction.id, groupId, meetingId, loanId],
      )
    ).rows[0];
    if (!repayment)
      throw new ConflictError(
        "Idempotency record does not match this loan repayment",
      );
    return { repayment, transaction, idempotent: true };
  });
}
export async function repayIdempotent(groupId, meetingId, loanId, data, user) {
  await assertGroupAction(user, groupId, GROUP_ACTION.LOAN_REPAY, pool);
  const prior = await priorRepayment(groupId, meetingId, loanId, data);
  if (prior) return prior;
  try {
    return await repay(groupId, meetingId, loanId, data, user);
  } catch (error) {
    const committed = await priorRepayment(groupId, meetingId, loanId, data);
    if (committed) return committed;
    throw error;
  }
}
