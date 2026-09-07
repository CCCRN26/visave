import crypto from "node:crypto";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import * as repo from "./meeting.repository";
import { assertGroupFinancialOperator } from "@/modules/group-access/group-access.service";
import { requireEffectiveCycleMembership } from "@/modules/cycle-participation/cycle-participation.service";
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)) {
    const [whole, fraction = ""] = value.split(".");
    return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
  }
  return value;
};
const fingerprint = (value) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
const reference = () =>
  `TXN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
async function existing(c, organizationId, key, fp) {
  const row = (
    await c.query(
      "SELECT * FROM financial_transactions WHERE organization_id=$1 AND idempotency_key=$2",
      [organizationId, key],
    )
  ).rows[0];
  if (row && row.request_fingerprint !== fp)
    throw new ConflictError(
      "Idempotency key was already used for a different request",
    );
  return row;
}
async function header(
  c,
  ctx,
  type,
  memberId,
  key,
  fp,
  user,
  reversalId = null,
) {
  return (
    await c.query(
      `INSERT INTO financial_transactions(organization_id,group_id,cycle_id,meeting_id,member_id,transaction_type,reference_code,effective_date,reversal_of_transaction_id,idempotency_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        ctx.organization_id,
        ctx.group_id,
        ctx.cycle_id,
        ctx.id,
        memberId,
        type,
        reference(),
        ctx.meeting_date,
        reversalId,
        key,
        fp,
        user.id,
      ],
    )
  ).rows[0];
}
async function entries(c, tx, accounts, debit, credit, amount) {
  await c.query(
    `INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) VALUES($1,$2,'DEBIT',$4),($1,$3,'CREDIT',$4)`,
    [tx.id, accounts[debit], accounts[credit], amount],
  );
}
export async function post(c, ctx, kind, data, user) {
  const actorContext = await assertGroupFinancialOperator(user, ctx.group_id, c);
  if (
    ctx.status !== "OPEN" ||
    ctx.group_status !== "ACTIVE" ||
    ctx.cycle_status !== "ACTIVE"
  )
    throw new ConflictError(
      "Financial transactions can only be recorded during an open meeting",
    );
  const fp = fingerprint({
      kind,
      ...data,
      groupId: ctx.group_id,
      meetingId: ctx.id,
    }),
    prior = await existing(c, ctx.organization_id, data.idempotencyKey, fp);
  if (prior) return { transaction: prior, idempotent: true };
  await requireEffectiveCycleMembership(c,{groupId:ctx.group_id,cycleId:ctx.cycle_id,memberId:data.memberId,effectiveDate:ctx.meeting_date});
  const snapshot = (
    await c.query(
      `SELECT m.* FROM meeting_attendance a JOIN group_members m ON m.id=a.member_id WHERE a.meeting_id=$1 AND a.member_id=$2`,
      [ctx.id, data.memberId],
    )
  ).rows[0];
  if (!snapshot)
    throw new ValidationError("Member is not part of this meeting snapshot");
  const constitution = (
      await c.query(
        "SELECT gc.* FROM group_constitutions gc WHERE gc.id=$1 AND gc.status='APPROVED'",
        [ctx.constitution_id],
      )
    ).rows[0],
    accounts = await repo.accountMap(c, ctx.cycle_id);
  let tx, domain, amount;
  if (kind === "SAVINGS") {
    const active = (
      await c.query(
        `SELECT 1 FROM savings_transactions s JOIN financial_transactions t ON t.id=s.financial_transaction_id
         WHERE s.meeting_id=$1 AND s.member_id=$2 AND s.transaction_kind='PURCHASE'
           AND NOT EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id)`,
        [ctx.id, data.memberId],
      )
    ).rowCount;
    if (active)
      throw new AppError(
        "Savings have already been recorded for this member in this meeting. Reverse the existing posting before recording a new one.",
        "SAVINGS_ALREADY_RECORDED",
        409,
      );
    const net = (
        await c.query(
          `SELECT COALESCE(SUM(CASE transaction_kind WHEN 'PURCHASE' THEN shares ELSE -shares END),0)::int n FROM savings_transactions WHERE meeting_id=$1 AND member_id=$2`,
          [ctx.id, data.memberId],
        )
      ).rows[0].n,
      next = net + data.numberOfShares;
    if (
      data.numberOfShares < constitution.min_shares_per_meeting ||
      next > constitution.max_shares_per_meeting
    )
      throw new ValidationError(
        `Savings must remain between ${constitution.min_shares_per_meeting} and ${constitution.max_shares_per_meeting} shares per meeting`,
      );
    amount = (
      await c.query("SELECT ($1::integer*$2::numeric)::numeric(18,2) amount", [
        data.numberOfShares,
        constitution.share_value,
      ])
    ).rows[0].amount;
    tx = await header(
      c,
      ctx,
      "SAVINGS_PURCHASE",
      data.memberId,
      data.idempotencyKey,
      fp,
      user,
    );
    await entries(
      c,
      tx,
      accounts,
      "SAVINGS_LOAN_CASH",
      "MEMBER_SAVINGS_CONTROL",
      amount,
    );
    domain = (
      await c.query(
        `INSERT INTO savings_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,transaction_kind,shares,share_value,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,'PURCHASE',$7,$8,$9,$10) RETURNING *`,
        [
          tx.id,
          ctx.organization_id,
          ctx.group_id,
          ctx.cycle_id,
          ctx.id,
          data.memberId,
          data.numberOfShares,
          constitution.share_value,
          amount,
          user.id,
        ],
      )
    ).rows[0];
  }
  if (kind === "SOCIAL") {
    const active = (
      await c.query(
        `SELECT 1 FROM social_fund_transactions s JOIN financial_transactions t ON t.id=s.financial_transaction_id WHERE s.meeting_id=$1 AND s.member_id=$2 AND s.transaction_kind='CONTRIBUTION' AND NOT EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id)`,
        [ctx.id, data.memberId],
      )
    ).rowCount;
    if (active)
      throw new AppError(
        "Social Fund has already been recorded for this member in this meeting. Reverse the existing posting before recording a new one.",
        "SOCIAL_FUND_ALREADY_RECORDED",
        409,
      );
    amount = constitution.social_fund_contribution;
    if (amount === "0.00")
      throw new ValidationError("Constitution has no social fund contribution");
    tx = await header(
      c,
      ctx,
      "SOCIAL_FUND_CONTRIBUTION",
      data.memberId,
      data.idempotencyKey,
      fp,
      user,
    );
    await entries(
      c,
      tx,
      accounts,
      "SOCIAL_FUND_CASH",
      "SOCIAL_FUND_CONTROL",
      amount,
    );
    domain = (
      await c.query(
        `INSERT INTO social_fund_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,transaction_kind,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,'CONTRIBUTION',$7,$8) RETURNING *`,
        [
          tx.id,
          ctx.organization_id,
          ctx.group_id,
          ctx.cycle_id,
          ctx.id,
          data.memberId,
          amount,
          user.id,
        ],
      )
    ).rows[0];
  }
  if (kind === "FINE") {
    const rule = (
      await c.query(
        `SELECT f.* FROM constitution_fine_rules f WHERE f.id=$1 AND f.constitution_id=$2 AND f.status='ACTIVE'`,
        [data.fineRuleId, ctx.constitution_id],
      )
    ).rows[0];
    if (!rule)
      throw new ValidationError(
        "Fine rule does not belong to the active cycle constitution",
      );
    const active = (
      await c.query(
        `SELECT 1 FROM fine_transactions f JOIN financial_transactions t ON t.id=f.financial_transaction_id WHERE f.meeting_id=$1 AND f.member_id=$2 AND f.fine_rule_id=$3 AND f.transaction_kind='FINE' AND NOT EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id)`,
        [ctx.id, data.memberId, rule.id],
      )
    ).rowCount;
    if (active)
      throw new ConflictError("This fine is already recorded for the member");
    amount = rule.amount;
    if (amount === "0.00")
      throw new ValidationError("Fine amount must be positive");
    tx = await header(
      c,
      ctx,
      "FINE",
      data.memberId,
      data.idempotencyKey,
      fp,
      user,
    );
    await entries(c, tx, accounts, "SAVINGS_LOAN_CASH", "FINE_INCOME", amount);
    domain = (
      await c.query(
        `INSERT INTO fine_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,fine_rule_id,transaction_kind,amount,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'FINE',$8,$9,$10) RETURNING *`,
        [
          tx.id,
          ctx.organization_id,
          ctx.group_id,
          ctx.cycle_id,
          ctx.id,
          data.memberId,
          rule.id,
          amount,
          data.reason || null,
          user.id,
        ],
      )
    ).rows[0];
  }
  await writeAudit(c, {
    organizationId: ctx.organization_id,
    actorUserId: user.id,
    action: `${kind === "SOCIAL" ? "SOCIAL_FUND" : kind}_RECORDED`,
    entityType: "FINANCIAL_TRANSACTION",
    entityId: tx.id,
    newValues: {
      ...domain,
      referenceCode: tx.reference_code,
      operationMode: actorContext.operation_mode,
      linkedMemberId: actorContext.linked_member_id || null,
      officerPosition: actorContext.officer_position || null,
    },
  });
  return { transaction: tx, domain, idempotent: false };
}
export async function reverse(c, ctx, transactionId, data, user) {
  await assertGroupFinancialOperator(user, ctx.group_id, c);
  if (ctx.status !== "OPEN" || ctx.cycle_status !== "ACTIVE")
    throw new ConflictError(
      "Reversals are only allowed while the meeting and cycle are open",
    );
  const original = (
    await c.query(
      `SELECT * FROM financial_transactions WHERE id=$1 AND meeting_id=$2 FOR UPDATE`,
      [transactionId, ctx.id],
    )
  ).rows[0];
  if (!original) throw new NotFoundError("Transaction not found");
  if (original.reversal_of_transaction_id)
    throw new ConflictError("A reversal cannot be reversed");
  const fp = fingerprint({
      kind: "REVERSAL",
      transactionId,
      groupId: ctx.group_id,
      meetingId: ctx.id,
    }),
    prior = await existing(c, ctx.organization_id, data.idempotencyKey, fp);
  if (prior) return { transaction: prior, idempotent: true };
  if (
    (
      await c.query(
        "SELECT 1 FROM financial_transactions WHERE reversal_of_transaction_id=$1",
        [original.id],
      )
    ).rowCount
  )
    throw new ConflictError("Transaction has already been reversed");
  const type = original.transaction_type
      .replace("PURCHASE", "REVERSAL")
      .replace("CONTRIBUTION", "REVERSAL")
      .replace(/^FINE$/, "FINE_REVERSAL"),
    tx = await header(
      c,
      ctx,
      type,
      original.member_id,
      data.idempotencyKey,
      fp,
      user,
      original.id,
    );
  await c.query(
    `INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) SELECT $1,ledger_account_id,CASE entry_side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,amount FROM ledger_entries WHERE financial_transaction_id=$2`,
    [tx.id, original.id],
  );
  let action;
  if (original.transaction_type === "SAVINGS_PURCHASE") {
    const o = (
      await c.query(
        "SELECT * FROM savings_transactions WHERE financial_transaction_id=$1",
        [original.id],
      )
    ).rows[0];
    await c.query(
      `INSERT INTO savings_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,transaction_kind,shares,share_value,amount,original_savings_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,'REVERSAL',$7,$8,$9,$10,$11)`,
      [
        tx.id,
        o.organization_id,
        o.group_id,
        o.cycle_id,
        o.meeting_id,
        o.member_id,
        o.shares,
        o.share_value,
        o.amount,
        o.id,
        user.id,
      ],
    );
    action = "SAVINGS_REVERSED";
  } else if (original.transaction_type === "SOCIAL_FUND_CONTRIBUTION") {
    const o = (
      await c.query(
        "SELECT * FROM social_fund_transactions WHERE financial_transaction_id=$1",
        [original.id],
      )
    ).rows[0];
    await c.query(
      `INSERT INTO social_fund_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,transaction_kind,amount,original_social_fund_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,'REVERSAL',$7,$8,$9)`,
      [
        tx.id,
        o.organization_id,
        o.group_id,
        o.cycle_id,
        o.meeting_id,
        o.member_id,
        o.amount,
        o.id,
        user.id,
      ],
    );
    action = "SOCIAL_FUND_REVERSED";
  } else if (original.transaction_type === "FINE") {
    const o = (
      await c.query(
        "SELECT * FROM fine_transactions WHERE financial_transaction_id=$1",
        [original.id],
      )
    ).rows[0];
    await c.query(
      `INSERT INTO fine_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,fine_rule_id,transaction_kind,amount,reason,original_fine_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'REVERSAL',$8,$9,$10,$11)`,
      [
        tx.id,
        o.organization_id,
        o.group_id,
        o.cycle_id,
        o.meeting_id,
        o.member_id,
        o.fine_rule_id,
        o.amount,
        o.reason,
        o.id,
        user.id,
      ],
    );
    action = "FINE_REVERSED";
  } else throw new ValidationError("Transaction type cannot be reversed");
  await writeAudit(c, {
    organizationId: ctx.organization_id,
    actorUserId: user.id,
    action,
    entityType: "FINANCIAL_TRANSACTION",
    entityId: tx.id,
    newValues: { reversalOf: original.id },
  });
  return { transaction: tx, idempotent: false };
}
export async function postLoanFinancial(
  c,
  ctx,
  { type, memberId, idempotencyKey, payload, lines },
  user,
) {
  const fp = fingerprint({
      type,
      ...payload,
      groupId: ctx.group_id,
      meetingId: ctx.id,
    }),
    prior = await existing(c, ctx.organization_id, idempotencyKey, fp);
  if (prior) return { transaction: prior, idempotent: true };
  const tx = await header(c, ctx, type, memberId, idempotencyKey, fp, user);
  const accounts = await repo.accountMap(c, ctx.cycle_id);
  for (const line of lines)
    await c.query(
      `INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) VALUES($1,$2,$3,$4)`,
      [tx.id, accounts[line.account], line.side, line.amount],
    );
  return { transaction: tx, idempotent: false };
}
export async function existingLoanFinancial(
  c,
  ctx,
  { type, idempotencyKey, payload },
) {
  const fp = fingerprint({
    type,
    ...payload,
    groupId: ctx.group_id,
    meetingId: ctx.id,
  });
  return existing(c, ctx.organization_id, idempotencyKey, fp);
}
export async function reverseLoanFinancial(
  c,
  ctx,
  original,
  idempotencyKey,
  user,
) {
  const fp = fingerprint({
      kind: "LOAN_REVERSAL",
      transactionId: original.id,
      groupId: ctx.group_id,
      meetingId: ctx.id,
    }),
    prior = await existing(c, ctx.organization_id, idempotencyKey, fp);
  if (prior) return { transaction: prior, idempotent: true };
  if (
    (
      await c.query(
        "SELECT 1 FROM financial_transactions WHERE reversal_of_transaction_id=$1",
        [original.id],
      )
    ).rowCount
  )
    throw new ConflictError("Transaction has already been reversed");
  const type =
      original.transaction_type === "LOAN_DISBURSEMENT"
        ? "LOAN_DISBURSEMENT_REVERSAL"
        : "LOAN_REPAYMENT_REVERSAL",
    tx = await header(
      c,
      ctx,
      type,
      original.member_id,
      idempotencyKey,
      fp,
      user,
      original.id,
    );
  await c.query(
    `INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) SELECT $1,ledger_account_id,CASE entry_side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,amount FROM ledger_entries WHERE financial_transaction_id=$2`,
    [tx.id, original.id],
  );
  return { transaction: tx, idempotent: false };
}
