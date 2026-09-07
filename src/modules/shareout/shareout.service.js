import crypto from "node:crypto";
import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import * as repository from "./shareout.repository";

const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reference = (prefix) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

function blockers(state) {
  const issues = [];
  if (state.group_status !== "ACTIVE") issues.push("GROUP_NOT_ACTIVE");
  if (state.cycle_status !== "ACTIVE") issues.push("CYCLE_NOT_ACTIVE");
  if (state.meeting_status !== "CLOSED") issues.push("FINAL_MEETING_NOT_CLOSED");
  if (state.other_open || state.prior_unresolved)
    issues.push("OPEN_PRIOR_MEETINGS");
  if (state.later_valid_meetings) issues.push("FINAL_MEETING_NOT_LATEST");
  if (state.outstanding_loans) issues.push("OUTSTANDING_LOANS");
  if (state.unresolved_requests) issues.push("UNRESOLVED_LOAN_REQUESTS");
  if (state.receivable !== "0.00") issues.push("LOAN_RECEIVABLE_DISCREPANCY");
  if (state.savings_control !== state.total_savings)
    issues.push("SAVINGS_CONTROL_DISCREPANCY");
  if (state.distributable_discrepancy !== "0.00")
    issues.push("DISTRIBUTABLE_FUND_DISCREPANCY");
  if (BigInt(state.total_shares) <= 0n) issues.push("NO_MEMBER_SHARES");
  if (state.unbalanced) issues.push("UNBALANCED_LEDGER");
  if (state.invalid_savings_rows) issues.push("SAVINGS_SHARE_VALUE_DISCREPANCY");
  return issues;
}

async function context(client, groupId, cycleId, meetingId, lock = false) {
  if(lock){
    await client.query("SELECT id FROM vsla_cycles WHERE id=$1 AND group_id=$2 FOR UPDATE",[cycleId,groupId]);
    await client.query("SELECT id FROM vsla_meetings WHERE id=$1 AND group_id=$2 AND cycle_id=$3 FOR UPDATE",[meetingId,groupId,cycleId]);
  }
  const row = (await client.query(
    `SELECT c.*,m.status meeting_status,m.organization_id FROM vsla_cycles c JOIN vsla_meetings m ON m.cycle_id=c.id WHERE c.id=$1 AND c.group_id=$2 AND m.id=$3`,
    [cycleId, groupId, meetingId],
  )).rows[0];
  if (!row) throw new NotFoundError("Cycle/final meeting not found");
  return row;
}
export async function readiness(groupId, cycleId, meetingId) {
  const state = await repository.financialState(
    pool,
    groupId,
    cycleId,
    meetingId,
  );
  if (!state) throw new NotFoundError("Cycle/final meeting not found");
  const blockingIssues = blockers(state);
  return {
    ready: blockingIssues.length === 0,
    blockingIssues,
    warnings: [],
    state,
  };
}
export async function cycleReadiness(groupId, cycleId) {
  const meeting = (
    await pool.query(
      "SELECT id FROM vsla_meetings WHERE group_id=$1 AND cycle_id=$2 AND status<>'CANCELLED' ORDER BY meeting_number DESC LIMIT 1",
      [groupId, cycleId],
    )
  ).rows[0];
  if (!meeting)
    return {
      ready: false,
      blockingIssues: ["NO_FINAL_MEETING"],
      warnings: [],
      state: null,
    };
  return readiness(groupId, cycleId, meeting.id);
}

export async function meetingCycleId(groupId, meetingId) {
  const meeting = (
    await pool.query(
      "SELECT cycle_id FROM vsla_meetings WHERE id=$1 AND group_id=$2",
      [meetingId, groupId],
    )
  ).rows[0];
  if (!meeting) throw new NotFoundError("Meeting not found");
  return meeting.cycle_id;
}

export async function prepare(groupId, cycleId, meetingId, user) {
  return withTransaction(async (client) => {
    const ctx = await context(client, groupId, cycleId, meetingId, true),
      state = await repository.financialState(
        client,
        groupId,
        cycleId,
        meetingId,
      ),
      blockingIssues = blockers(state);
    if (blockingIssues.length)
      throw new ValidationError("Cycle is not ready for share-out", {
        blockingIssues,
      });
    const fingerprint = hash(state),
      version = (
        await client.query(
          "SELECT COALESCE(MAX(version_number),0)+1 n FROM cycle_shareouts WHERE cycle_id=$1",
          [cycleId],
        )
      ).rows[0].n,
      shareout = (
        await client.query(
          `INSERT INTO cycle_shareouts(organization_id,group_id,cycle_id,final_meeting_id,version_number,status,total_net_shares,total_net_savings,fine_income,service_charge_income,distributable_fund,raw_value_per_share,social_fund_balance_snapshot,financial_state_fingerprint,prepared_by) VALUES($1,$2,$3,$4,$5,'DRAFT',$6::bigint,$7,$8,$9,$10,($10::numeric/$6::bigint)::numeric(24,8),$11,$12,$13) RETURNING *`,
          [
            ctx.organization_id,
            groupId,
            cycleId,
            meetingId,
            version,
            state.total_shares,
            state.total_savings,
            state.fine_income,
            state.charge_income,
            state.savings_cash,
            state.social_cash,
            fingerprint,
            user.id,
          ],
        )
      ).rows[0],
      rows = await repository.entitlementRows(
        client,
        cycleId,
        state.savings_cash,
      );
    for (const row of rows)
      await client.query(
        `INSERT INTO cycle_shareout_entitlements(organization_id,group_id,cycle_id,shareout_id,member_id,member_code_snapshot,member_name_snapshot,net_shares,net_savings,raw_entitlement,base_rounded_entitlement,rounding_adjustment,final_entitlement,surplus_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8::bigint,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::numeric,($13::numeric-$9::numeric)::numeric(18,2))`,
        [
          ctx.organization_id,
          groupId,
          cycleId,
          shareout.id,
          row.id,
          row.member_code,
          row.member_name,
          row.net_shares,
          row.net_savings,
          row.raw_amount,
          row.base_amount,
          row.adjustment,
          row.final_amount,
        ],
      );
    await writeAudit(client, {
      organizationId: ctx.organization_id,
      actorUserId: user.id,
      action: "SHAREOUT_PREPARED",
      entityType: "CYCLE_SHAREOUT",
      entityId: shareout.id,
      newValues: shareout,
    });
    return getShareout(groupId, cycleId, shareout.id, client);
  });
}

export async function getShareout(
  groupId,
  cycleId,
  shareoutId = null,
  client = pool,
) {
  const shareout = (
    await client.query(
      `SELECT * FROM cycle_shareouts WHERE group_id=$1 AND cycle_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY version_number DESC LIMIT 1`,
      [groupId, cycleId, shareoutId],
    )
  ).rows[0];
  if (!shareout) return null;
  const entitlements = (
    await client.query(
      `SELECT e.*,m.status member_status,COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYOUT' THEN p.amount ELSE -p.amount END),0)::numeric(18,2) net_paid,COALESCE(json_agg(json_build_object('id',p.id,'kind',p.transaction_kind,'amount',p.amount,'createdAt',p.created_at,'originalPayoutId',p.original_shareout_payout_id) ORDER BY p.created_at) FILTER(WHERE p.id IS NOT NULL),'[]'::json) payout_history FROM cycle_shareout_entitlements e JOIN group_members m ON m.id=e.member_id LEFT JOIN shareout_payouts p ON p.entitlement_id=e.id WHERE e.shareout_id=$1 GROUP BY e.id,m.status ORDER BY e.member_code_snapshot`,
      [shareout.id],
    )
  ).rows;
  return { shareout, entitlements };
}

async function accounts(client, cycleId) {
  return Object.fromEntries(
    (
      await client.query(
        "SELECT account_code,id FROM ledger_accounts WHERE cycle_id=$1",
        [cycleId],
      )
    ).rows.map((row) => [row.account_code, row.id]),
  );
}
async function financialHeader(
  client,
  ctx,
  type,
  key,
  fingerprint,
  user,
  meetingId = ctx.final_meeting_id,
  memberId = null,
  reversalId = null,
) {
  return (
    await client.query(
      `INSERT INTO financial_transactions(organization_id,group_id,cycle_id,meeting_id,member_id,transaction_type,reference_code,effective_date,reversal_of_transaction_id,idempotency_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9,$10,$11) RETURNING *`,
      [
        ctx.organization_id,
        ctx.group_id,
        ctx.cycle_id,
        meetingId,
        memberId,
        type,
        reference("SHAREOUT"),
        reversalId,
        key,
        fingerprint,
        user.id,
      ],
    )
  ).rows[0];
}
async function addEntry(client, transactionId, accountId, side, amount) {
  await client.query(
    "INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) VALUES($1,$2,$3,$4)",
    [transactionId, accountId, side, amount],
  );
}
async function existingFinancial(client, organizationId, key, fingerprint) {
  const row = (
    await client.query(
      "SELECT * FROM financial_transactions WHERE organization_id=$1 AND idempotency_key=$2",
      [organizationId, key],
    )
  ).rows[0];
  if (row && row.request_fingerprint !== fingerprint)
    throw new ConflictError(
      "Idempotency key was already used for a different request",
    );
  return row;
}

export async function approve(groupId, cycleId, shareoutId, data, user) {
  return withTransaction(async (client) => {
    const candidate=(await client.query("SELECT final_meeting_id FROM cycle_shareouts WHERE id=$1 AND group_id=$2 AND cycle_id=$3",[shareoutId,groupId,cycleId])).rows[0];
    if(!candidate)throw new NotFoundError("Share-out not found");
    await context(client,groupId,cycleId,candidate.final_meeting_id,true);
    const draft = (
      await client.query(
        "SELECT * FROM cycle_shareouts WHERE id=$1 AND group_id=$2 AND cycle_id=$3 FOR UPDATE",
        [shareoutId, groupId, cycleId],
      )
    ).rows[0];
    if (!draft) throw new NotFoundError("Share-out not found");
    const fingerprint = hash({ operation: "SHAREOUT_APPROVAL", shareoutId });
    if (draft.status !== "DRAFT") {
      const prior = await existingFinancial(
        client,
        draft.organization_id,
        data.idempotencyKey,
        fingerprint,
      );
      if (prior?.id === draft.reclassification_financial_transaction_id)
        return getShareout(groupId, cycleId, draft.id, client);
      throw new ConflictError("Only a draft share-out can be approved");
    }
    const state = await repository.financialState(
        client,
        groupId,
        cycleId,
        draft.final_meeting_id,
      ),
      issues = blockers(state);
    if (issues.length)
      throw new ValidationError("Cycle is not ready for share-out", {
        blockingIssues: issues,
      });
    if (hash(state) !== draft.financial_state_fingerprint)
      throw new ConflictError("SHAREOUT_SNAPSHOT_STALE");
    const totals = (
      await client.query(
        "SELECT COALESCE(SUM(final_entitlement),0)::numeric(18,2) total FROM cycle_shareout_entitlements WHERE shareout_id=$1",
        [draft.id],
      )
    ).rows[0];
    if (totals.total !== draft.distributable_fund)
      throw new ConflictError("Share-out entitlement total does not reconcile");
    const prior = await existingFinancial(
        client,
        draft.organization_id,
        data.idempotencyKey,
        fingerprint,
      );
    if (prior) {
      if (prior.id !== draft.reclassification_financial_transaction_id)
        throw new ConflictError("Idempotency result does not match share-out");
      return getShareout(groupId, cycleId, draft.id, client);
    }
    const map = await accounts(client, cycleId),
      transaction = await financialHeader(
        client,
        draft,
        "SHAREOUT_RECLASSIFICATION",
        data.idempotencyKey,
        fingerprint,
        user,
      );
    for (const [source, amount] of [
      ["MEMBER_SAVINGS_CONTROL", draft.total_net_savings],
      ["FINE_INCOME", draft.fine_income],
      ["LOAN_SERVICE_CHARGE_INCOME", draft.service_charge_income],
    ])
      if (amount !== "0.00")
        await addEntry(client, transaction.id, map[source], "DEBIT", amount);
    await addEntry(
      client,
      transaction.id,
      map.SHAREOUT_PAYABLE,
      "CREDIT",
      draft.distributable_fund,
    );
    await client.query(
      "UPDATE cycle_shareouts SET status='APPROVED',approved_by=$2,approved_at=now(),reclassification_financial_transaction_id=$3 WHERE id=$1",
      [draft.id, user.id, transaction.id],
    );
    await client.query(
      "UPDATE vsla_cycles SET status='CLOSING',updated_at=now() WHERE id=$1 AND status='ACTIVE'",
      [cycleId],
    );
    await writeAudit(client, {
      organizationId: draft.organization_id,
      actorUserId: user.id,
      action: "SHAREOUT_APPROVED",
      entityType: "CYCLE_SHAREOUT",
      entityId: draft.id,
      newValues: { transactionId: transaction.id },
    });
    return getShareout(groupId, cycleId, draft.id, client);
  });
}

export async function payout(
  groupId,
  cycleId,
  meetingId,
  shareoutId,
  data,
  user,
) {
  return withTransaction(async (client) => {
    await context(client,groupId,cycleId,meetingId,true);
    const shareout = (
      await client.query(
        "SELECT * FROM cycle_shareouts WHERE id=$1 AND group_id=$2 AND cycle_id=$3 AND final_meeting_id=$4 FOR UPDATE",
        [shareoutId, groupId, cycleId, meetingId],
      )
    ).rows[0];
    if (!shareout) throw new NotFoundError("Share-out not found");
    const entitlement = (
      await client.query(
        "SELECT * FROM cycle_shareout_entitlements WHERE id=$1 AND shareout_id=$2 AND final_entitlement>0 FOR UPDATE",
        [data.entitlementId, shareout.id],
      )
    ).rows[0];
    if (!entitlement) throw new ValidationError("Positive entitlement not found");
    const fingerprint = hash({
        operation: "SHAREOUT_PAYOUT",
        shareoutId,
        entitlementId: entitlement.id,
      }),
      prior = await existingFinancial(
        client,
        shareout.organization_id,
        data.idempotencyKey,
        fingerprint,
      );
    if (prior) {
      const existing = (
        await client.query(
          "SELECT * FROM shareout_payouts WHERE financial_transaction_id=$1",
          [prior.id],
        )
      ).rows[0];
      return { payout: existing, transaction: prior, idempotent: true };
    }
    const ctx = await context(client, groupId, cycleId, meetingId);
    if (
      ctx.status !== "CLOSING" ||
      ctx.meeting_status !== "CLOSED" ||
      !["APPROVED", "PAYOUT_IN_PROGRESS"].includes(shareout.status)
    )
      throw new ConflictError(
        "Payout requires an approved share-out anchored to the completed final meeting",
      );
    const active = (
      await client.query(
        `SELECT 1 FROM shareout_payouts p WHERE p.entitlement_id=$1 AND p.transaction_kind='PAYOUT' AND NOT EXISTS(SELECT 1 FROM shareout_payouts r WHERE r.original_shareout_payout_id=p.id)`,
        [entitlement.id],
      )
    ).rowCount;
    if (active) throw new ConflictError("Entitlement is already paid");
    const map = await accounts(client, cycleId),
      transaction = await financialHeader(
        client,
        shareout,
        "SHAREOUT_PAYOUT",
        data.idempotencyKey,
        fingerprint,
        user,
        meetingId,
        entitlement.member_id,
      );
    await addEntry(
      client,
      transaction.id,
      map.SHAREOUT_PAYABLE,
      "DEBIT",
      entitlement.final_entitlement,
    );
    await addEntry(
      client,
      transaction.id,
      map.SAVINGS_LOAN_CASH,
      "CREDIT",
      entitlement.final_entitlement,
    );
    const record = (
      await client.query(
        `INSERT INTO shareout_payouts(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,shareout_id,entitlement_id,member_id,transaction_kind,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PAYOUT',$9,$10) RETURNING *`,
        [
          transaction.id,
          shareout.organization_id,
          groupId,
          cycleId,
          meetingId,
          shareout.id,
          entitlement.id,
          entitlement.member_id,
          entitlement.final_entitlement,
          user.id,
        ],
      )
    ).rows[0];
    await client.query(
      "UPDATE cycle_shareouts SET status='PAYOUT_IN_PROGRESS' WHERE id=$1 AND status='APPROVED'",
      [shareout.id],
    );
    await writeAudit(client, {
      organizationId: shareout.organization_id,
      actorUserId: user.id,
      action: "SHAREOUT_PAYOUT_RECORDED",
      entityType: "SHAREOUT_PAYOUT",
      entityId: record.id,
      newValues: record,
    });
    return { payout: record, transaction, idempotent: false };
  });
}

export async function reversePayout(
  groupId,
  cycleId,
  meetingId,
  shareoutId,
  payoutId,
  data,
  user,
) {
  return withTransaction(async (client) => {
    const ctx = await context(client, groupId, cycleId, meetingId, true);
    if (ctx.status !== "CLOSING" || ctx.meeting_status !== "CLOSED")
      throw new ConflictError(
        "Payout reversals require a completed final meeting in a closing cycle",
      );
    const shareout = (await client.query("SELECT * FROM cycle_shareouts WHERE id=$1 AND group_id=$2 AND cycle_id=$3 AND final_meeting_id=$4 FOR UPDATE",[shareoutId,groupId,cycleId,meetingId])).rows[0];
    if(!shareout) throw new NotFoundError("Share-out not found");
    if(shareout.status==='COMPLETED') throw new ConflictError("SHAREOUT_COMPLETED_PAYOUT_REVERSAL_NOT_ALLOWED");
    if(!['APPROVED','PAYOUT_IN_PROGRESS'].includes(shareout.status)) throw new ConflictError("Payout reversal requires an approved share-out");
    const original = (
      await client.query(
        `SELECT p.*,s.organization_id FROM shareout_payouts p JOIN cycle_shareouts s ON s.id=p.shareout_id WHERE p.id=$1 AND p.group_id=$2 AND p.cycle_id=$3 AND p.meeting_id=$4 AND p.shareout_id=$5 AND p.transaction_kind='PAYOUT' FOR UPDATE OF p`,
        [payoutId, groupId, cycleId, meetingId, shareoutId],
      )
    ).rows[0];
    if (!original) throw new NotFoundError("Payout not found");
    const fingerprint = hash({
        operation: "SHAREOUT_PAYOUT_REVERSAL",
        payoutId,
      }),
      prior = await existingFinancial(
        client,
        original.organization_id,
        data.idempotencyKey,
        fingerprint,
      );
    if (prior) {
      const record = (
        await client.query(
          "SELECT * FROM shareout_payouts WHERE financial_transaction_id=$1",
          [prior.id],
        )
      ).rows[0];
      return { payout: record, transaction: prior, idempotent: true };
    }
    if (
      (
        await client.query(
          "SELECT 1 FROM shareout_payouts WHERE original_shareout_payout_id=$1",
          [original.id],
        )
      ).rowCount
    )
      throw new ConflictError("Payout is already reversed");
    const transaction = await financialHeader(
        client,
        shareout,
        "SHAREOUT_PAYOUT_REVERSAL",
        data.idempotencyKey,
        fingerprint,
        user,
        meetingId,
        original.member_id,
        original.financial_transaction_id,
      );
    await client.query(
      `INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) SELECT $1,ledger_account_id,CASE entry_side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,amount FROM ledger_entries WHERE financial_transaction_id=$2`,
      [transaction.id, original.financial_transaction_id],
    );
    const record = (
      await client.query(
        `INSERT INTO shareout_payouts(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,shareout_id,entitlement_id,member_id,transaction_kind,amount,original_shareout_payout_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'REVERSAL',$9,$10,$11) RETURNING *`,
        [
          transaction.id,
          original.organization_id,
          groupId,
          cycleId,
          meetingId,
          shareoutId,
          original.entitlement_id,
          original.member_id,
          original.amount,
          original.id,
          user.id,
        ],
      )
    ).rows[0];
    await writeAudit(client, {
      organizationId: original.organization_id,
      actorUserId: user.id,
      action: "SHAREOUT_PAYOUT_REVERSED",
      entityType: "SHAREOUT_PAYOUT",
      entityId: record.id,
      newValues: record,
    });
    return { payout: record, transaction, idempotent: false };
  });
}

export async function complete(groupId, cycleId, shareoutId, user) {
  return withTransaction(async (client) => {
    const candidate=(await client.query("SELECT final_meeting_id FROM cycle_shareouts WHERE id=$1 AND group_id=$2 AND cycle_id=$3",[shareoutId,groupId,cycleId])).rows[0];
    if(!candidate)throw new NotFoundError("Share-out not found");
    await context(client,groupId,cycleId,candidate.final_meeting_id,true);
    const shareout = (
      await client.query(
        "SELECT * FROM cycle_shareouts WHERE id=$1 AND group_id=$2 AND cycle_id=$3 FOR UPDATE",
        [shareoutId, groupId, cycleId],
      )
    ).rows[0];
    if (!shareout) throw new NotFoundError("Share-out not found");
    if (shareout.status === "COMPLETED")
      return getShareout(groupId, cycleId, shareoutId, client);
    if (!["APPROVED", "PAYOUT_IN_PROGRESS"].includes(shareout.status))
      throw new ConflictError("Share-out cannot be completed");
    const proof = (
        await client.query(
          `SELECT COALESCE(SUM(e.final_entitlement),0)::numeric(18,2) entitlement,COALESCE(SUM(p.net),0)::numeric(18,2) paid FROM cycle_shareout_entitlements e LEFT JOIN(SELECT entitlement_id,SUM(CASE transaction_kind WHEN 'PAYOUT' THEN amount ELSE -amount END) net FROM shareout_payouts GROUP BY entitlement_id)p ON p.entitlement_id=e.id WHERE e.shareout_id=$1`,
          [shareoutId],
        )
      ).rows[0],
      map = await accounts(client, cycleId),
      balances = (
        await client.query(
          `SELECT a.account_code,COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id WHERE a.id=ANY($1::uuid[]) GROUP BY a.account_code`,
          [[map.SHAREOUT_PAYABLE, map.SAVINGS_LOAN_CASH]],
        )
      ).rows;
    if (
      proof.entitlement !== proof.paid ||
      balances.some((row) => row.balance !== "0.00")
    )
      throw new ConflictError(
        "All entitlements must be paid and closing cash/payable must be zero",
      );
    await client.query(
      "UPDATE cycle_shareouts SET status='COMPLETED',completed_by=$2,completed_at=now() WHERE id=$1",
      [shareoutId, user.id],
    );
    await writeAudit(client, {
      organizationId: shareout.organization_id,
      actorUserId: user.id,
      action: "SHAREOUT_COMPLETED",
      entityType: "CYCLE_SHAREOUT",
      entityId: shareoutId,
      newValues: proof,
    });
    return getShareout(groupId, cycleId, shareoutId, client);
  });
}

async function ensureAccounts(client, cycle) {
  await client.query(
    `INSERT INTO ledger_accounts(organization_id,group_id,cycle_id,account_code,account_name,account_category,normal_side,fund_type) SELECT $1,$2,$3,v.code,v.name,v.category,v.side,v.fund FROM(VALUES ('SAVINGS_LOAN_CASH','Savings/Loan Cash','ASSET','DEBIT','SAVINGS_LOAN'),('SOCIAL_FUND_CASH','Social Fund Cash','ASSET','DEBIT','SOCIAL_FUND'),('MEMBER_SAVINGS_CONTROL','Member Savings Control','EQUITY','CREDIT','SAVINGS_LOAN'),('SOCIAL_FUND_CONTROL','Social Fund Control','EQUITY','CREDIT','SOCIAL_FUND'),('FINE_INCOME','Fine Income','INCOME','CREDIT','SAVINGS_LOAN'),('LOANS_RECEIVABLE','Loans Receivable','ASSET','DEBIT','SAVINGS_LOAN'),('LOAN_SERVICE_CHARGE_INCOME','Loan Service Charge Income','INCOME','CREDIT','SAVINGS_LOAN'),('SHAREOUT_PAYABLE','Share-Out Payable','LIABILITY','CREDIT','SAVINGS_LOAN'))v(code,name,category,side,fund) ON CONFLICT(cycle_id,account_code) DO NOTHING`,
    [cycle.organization_id, cycle.group_id, cycle.id],
  );
}
export async function carryForward(groupId, cycleId, data, user) {
  return withTransaction(async (client) => {
    const cycles = (
        await client.query(
          "SELECT * FROM vsla_cycles WHERE id=ANY($1::uuid[]) ORDER BY cycle_number FOR UPDATE",
          [[cycleId, data.targetCycleId]],
        )
      ).rows,
      source = cycles.find((row) => row.id === cycleId),
      target = cycles.find((row) => row.id === data.targetCycleId);
    if (!source || !target)
      throw new NotFoundError("Source or target cycle not found");
    if (
      source.group_id !== groupId ||
      target.group_id !== groupId ||
      source.organization_id !== target.organization_id
    )
      throw new ValidationError("Target cycle must belong to the same group");
    const fingerprint = hash({
        operation: "SOCIAL_FUND_CARRY_FORWARD",
        sourceCycleId: cycleId,
        targetCycleId: target.id,
      }),
      prior = (
        await client.query(
          "SELECT * FROM cycle_social_fund_transfers WHERE organization_id=$1 AND idempotency_key=$2",
          [source.organization_id, data.idempotencyKey],
        )
      ).rows[0];
    if (prior) {
      if (prior.request_fingerprint !== fingerprint)
        throw new ConflictError(
          "Idempotency key was already used for another transfer",
        );
      return prior;
    }
    if (
      source.status !== "CLOSING" ||
      target.status !== "READY" ||
      target.cycle_number !== source.cycle_number + 1
    )
      throw new ConflictError(
        "Carry-forward requires the next READY cycle and a CLOSING source",
      );
    if (
      !(
        await client.query(
          "SELECT 1 FROM cycle_shareouts WHERE cycle_id=$1 AND status='COMPLETED'",
          [source.id],
        )
      ).rowCount
    )
      throw new ConflictError("Share-out must be completed first");
    await ensureAccounts(client, target);
    const sourceMap = await accounts(client, source.id),
      targetMap = await accounts(client, target.id),
      amountResult = (
        await client.query(
          `SELECT COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) amount,COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)>0 has_amount FROM ledger_entries e WHERE e.ledger_account_id=$1`,
          [sourceMap.SOCIAL_FUND_CASH],
        )
      ).rows[0],
      amount = amountResult.amount;
    if (!amountResult.has_amount)
      throw new ConflictError("No Social Fund balance requires carry-forward");
    const internalKey = hash({
      operation: "SOCIAL_FUND_CARRY_FORWARD",
      idempotencyKey: data.idempotencyKey,
    });
    const out = await financialHeader(
        client,
        { ...source, cycle_id: source.id, final_meeting_id: null },
        "SOCIAL_FUND_CARRY_FORWARD_OUT",
        `${internalKey}:OUT`,
        hash({ fingerprint, side: "OUT" }),
        user,
        null,
      ),
      incoming = await financialHeader(
        client,
        { ...target, cycle_id: target.id, final_meeting_id: null },
        "SOCIAL_FUND_CARRY_FORWARD_IN",
        `${internalKey}:IN`,
        hash({ fingerprint, side: "IN" }),
        user,
        null,
      );
    await addEntry(
      client,
      out.id,
      sourceMap.SOCIAL_FUND_CONTROL,
      "DEBIT",
      amount,
    );
    await addEntry(
      client,
      out.id,
      sourceMap.SOCIAL_FUND_CASH,
      "CREDIT",
      amount,
    );
    await addEntry(
      client,
      incoming.id,
      targetMap.SOCIAL_FUND_CASH,
      "DEBIT",
      amount,
    );
    await addEntry(
      client,
      incoming.id,
      targetMap.SOCIAL_FUND_CONTROL,
      "CREDIT",
      amount,
    );
    const transfer = (
      await client.query(
        `INSERT INTO cycle_social_fund_transfers(organization_id,group_id,source_cycle_id,target_cycle_id,amount,source_financial_transaction_id,target_financial_transaction_id,idempotency_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          source.organization_id,
          groupId,
          source.id,
          target.id,
          amount,
          out.id,
          incoming.id,
          data.idempotencyKey,
          fingerprint,
          user.id,
        ],
      )
    ).rows[0];
    await writeAudit(client, {
      organizationId: source.organization_id,
      actorUserId: user.id,
      action: "SOCIAL_FUND_CARRIED_FORWARD",
      entityType: "CYCLE_SOCIAL_FUND_TRANSFER",
      entityId: transfer.id,
      newValues: transfer,
    });
    return transfer;
  });
}

export async function activateNextCycle(groupId, cycleId, user) {
  return withTransaction(async (client) => {
    const target = (
      await client.query(
        "SELECT * FROM vsla_cycles WHERE id=$1 AND group_id=$2 FOR UPDATE",
        [cycleId, groupId],
      )
    ).rows[0];
    if (!target) throw new NotFoundError("Cycle not found");
    if (target.status === "ACTIVE") return target;
    if (target.status !== "READY") throw new ConflictError("Only a READY cycle can be activated");
    const source = (
      await client.query(
        "SELECT * FROM vsla_cycles WHERE group_id=$1 AND cycle_number=$2 FOR UPDATE",
        [groupId, target.cycle_number - 1],
      )
    ).rows[0];
    if (!source || source.status!=="CLOSED")
      throw new ConflictError("PREVIOUS_CYCLE_NOT_CLOSED");
    if (!(await client.query("SELECT 1 FROM cycle_shareouts WHERE cycle_id=$1 AND status='COMPLETED'", [source.id])).rowCount)
      throw new ConflictError("The preceding share-out is not complete");
    const socialBalance = (
      await client.query(
        `SELECT COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) balance FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id WHERE a.cycle_id=$1 AND a.account_code='SOCIAL_FUND_CASH'`,
        [source.id],
      )
    ).rows[0].balance;
    if (socialBalance !== "0.00") throw new ConflictError("Social Fund disposition is incomplete");
    const participantCount=(await client.query('SELECT COUNT(*)::int count FROM cycle_memberships WHERE cycle_id=$1',[target.id])).rows[0].count;
    if(participantCount<1)throw new AppError('Select at least one member before starting this cycle.','CYCLE_PARTICIPANTS_REQUIRED',409);
    const invalidOfficers=(await client.query(`SELECT COUNT(*)::int count FROM group_officer_assignments o LEFT JOIN cycle_memberships cm ON cm.cycle_id=o.cycle_id AND cm.member_id=o.member_id WHERE o.cycle_id=$1 AND o.status='ACTIVE' AND cm.id IS NULL`,[target.id])).rows[0].count;
    if(invalidOfficers>0)throw new AppError('Every assigned officer must participate in this cycle.','CYCLE_OFFICER_NOT_PARTICIPANT',409);
    const officerPositions=(await client.query(`SELECT array_agg(position_code) positions,COUNT(DISTINCT position_code)::int count FROM group_officer_assignments WHERE cycle_id=$1 AND status='ACTIVE'`,[target.id])).rows[0];
    if(officerPositions.count<5){const labels={CHAIRPERSON:'Chairperson',RECORD_KEEPER:'Record Keeper',BOX_KEEPER:'Box Keeper',MONEY_COUNTER_1:'Money Counter 1',MONEY_COUNTER_2:'Money Counter 2'},missing=Object.keys(labels).find(code=>!officerPositions.positions?.includes(code));throw new AppError(`Assign a ${labels[missing]||'required officer'} before starting Cycle ${target.cycle_number}.`,'CYCLE_OFFICERS_INCOMPLETE',409)}
    const activated = (
      await client.query(
        "UPDATE vsla_cycles SET status='ACTIVE',activated_at=now(),updated_at=now() WHERE id=$1 RETURNING *",
        [target.id],
      )
    ).rows[0];
    await writeAudit(client, { organizationId: target.organization_id, actorUserId: user.id, action: "CYCLE_ACTIVATED", entityType: "VSLA_CYCLE", entityId: target.id, newValues: activated });
    return activated;
  });
}

export async function closureReadiness(groupId, cycleId, client = pool) {
  const proof = (
    await client.query(
      `SELECT c.status cycle_status,g.status group_status,lm.id latest_meeting_id,lm.status meeting_status,
       s.final_meeting_id,s.status shareout_status,r.status reconciliation_status,
       COALESCE((SELECT SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END) FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id WHERE a.cycle_id=c.id AND a.account_code='SOCIAL_FUND_CASH'),0)::numeric(18,2) social_cash,
       COALESCE((SELECT SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END) FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id WHERE a.cycle_id=c.id AND a.account_code='SAVINGS_LOAN_CASH'),0)::numeric(18,2) savings_cash,
       COALESCE((SELECT SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END) FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id WHERE a.cycle_id=c.id AND a.account_code='SHAREOUT_PAYABLE'),0)::numeric(18,2) shareout_payable,
       r.expected_savings_loan_balance,r.expected_social_fund_balance,
       (SELECT COUNT(*)::int FROM cycle_social_fund_transfers WHERE source_cycle_id=c.id) transfers,
       (SELECT COUNT(*)::int FROM loan_requests WHERE cycle_id=c.id AND status IN('PENDING','APPROVED')) unresolved_requests,
       (SELECT COUNT(*)::int FROM loans WHERE cycle_id=c.id AND settled_at IS NULL AND voided_at IS NULL) outstanding_loans
       FROM vsla_cycles c JOIN vsla_groups g ON g.id=c.group_id
       LEFT JOIN LATERAL(SELECT * FROM cycle_shareouts WHERE cycle_id=c.id ORDER BY version_number DESC LIMIT 1)s ON true
       LEFT JOIN LATERAL(SELECT * FROM vsla_meetings WHERE cycle_id=c.id AND status<>'CANCELLED' ORDER BY meeting_number DESC LIMIT 1)lm ON true
       LEFT JOIN LATERAL(SELECT * FROM meeting_reconciliations WHERE meeting_id=lm.id ORDER BY created_at DESC LIMIT 1)r ON true
       WHERE c.id=$1 AND c.group_id=$2`,
      [cycleId, groupId],
    )
  ).rows[0];
  if (!proof) throw new NotFoundError("Cycle not found");
  const blockingIssues = [];
  if (proof.cycle_status !== "CLOSING")
    blockingIssues.push("CYCLE_NOT_CLOSING");
  if (proof.shareout_status !== "COMPLETED")
    blockingIssues.push("SHAREOUT_NOT_COMPLETED");
  if (!proof.latest_meeting_id || proof.final_meeting_id !== proof.latest_meeting_id)
    blockingIssues.push("FINAL_MEETING_NOT_LATEST");
  if (proof.meeting_status !== "CLOSED")
    blockingIssues.push("FINAL_MEETING_NOT_CLOSED");
  if (proof.reconciliation_status !== "BALANCED")
    blockingIssues.push("FINAL_RECONCILIATION_NOT_BALANCED");
  if(proof.reconciliation_status==='BALANCED'&&(proof.expected_savings_loan_balance!==proof.savings_cash||proof.expected_social_fund_balance!==proof.social_cash))
    blockingIssues.push("FINAL_RECONCILIATION_STALE");
  if (proof.social_cash !== "0.00" && !proof.transfers)
    blockingIssues.push("SOCIAL_FUND_NOT_CARRIED_FORWARD");
  if(proof.unresolved_requests)blockingIssues.push("UNRESOLVED_LOAN_REQUESTS");
  if(proof.outstanding_loans)blockingIssues.push("OUTSTANDING_LOANS");
  return { ready: blockingIssues.length === 0, blockingIssues, proof };
}

export async function cycleTransitionState(groupId, cycleId, client=pool){
  const closure=await closureReadiness(groupId,cycleId,client);
  const next=(await client.query(`SELECT id,cycle_number,status,start_date::text,expected_end_date::text,expected_shareout_date::text,meeting_day_of_week FROM vsla_cycles WHERE group_id=$1 AND cycle_number=(SELECT cycle_number+1 FROM vsla_cycles WHERE id=$2 AND group_id=$1)`,[groupId,cycleId])).rows[0]||null;
  return{closure,nextCycle:next};
}
export async function closeCycle(groupId, cycleId, user) {
  return withTransaction(async (client) => {
    await client.query(
      "SELECT 1 FROM vsla_cycles WHERE id=$1 AND group_id=$2 FOR UPDATE",
      [cycleId, groupId],
    );
    const result = await closureReadiness(groupId, cycleId, client);
    if (!result.ready)
      throw new ConflictError("Cycle is not ready to close", result);
    const balances = (
      await client.query(
        `SELECT a.account_code,COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id WHERE a.cycle_id=$1 AND a.account_code=ANY($2::text[]) GROUP BY a.account_code`,
        [
          cycleId,
          [
            "SAVINGS_LOAN_CASH",
            "SOCIAL_FUND_CASH",
            "LOANS_RECEIVABLE",
            "MEMBER_SAVINGS_CONTROL",
            "FINE_INCOME",
            "LOAN_SERVICE_CHARGE_INCOME",
            "SHAREOUT_PAYABLE",
          ],
        ],
      )
    ).rows;
    if (balances.some((row) => row.balance !== "0.00"))
      throw new ConflictError("Closed-cycle ledger accounts must all be zero");
    const cycle = (
      await client.query(
        "UPDATE vsla_cycles SET status='CLOSED',closed_at=now(),closed_by=$2,updated_at=now() WHERE id=$1 RETURNING *",
        [cycleId, user.id],
      )
    ).rows[0];
    await writeAudit(client, {
      organizationId: cycle.organization_id,
      actorUserId: user.id,
      action: "CYCLE_CLOSED",
      entityType: "VSLA_CYCLE",
      entityId: cycle.id,
      newValues: cycle,
    });
    return cycle;
  });
}
