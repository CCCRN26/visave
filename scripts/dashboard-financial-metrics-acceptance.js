import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import nextEnv from "@next/env";
import { databaseUrlFor, requireDisposableDatabaseName } from "./lib/disposable-database.js";
import { dashboardMetrics } from "../src/modules/dashboard/dashboard.repository.js";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const database = requireDisposableDatabaseName(
  process.env.DASHBOARD_METRICS_ACCEPTANCE_DB || "cccrn_vsla_acceptance",
);
const connectionString = databaseUrlFor(
  new URL(process.env.DATABASE_URL),
  database,
).toString();
const db = new pg.Client({ connectionString });
const token = crypto.randomUUID().slice(0, 8);
const results = [];
let sequence = 0;
let transactionOpen = false;

const nextKey = (prefix) => `${prefix}-${token}-${++sequence}`;
const fingerprint = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const expectMoney = (metrics, field, expected, scenario) =>
  assert.equal(metrics[field], expected, `${scenario}: ${field}`);

await db.connect();
try {
  await db.query("BEGIN");
  transactionOpen = true;

  const organizationId = (
    await db.query(
      "INSERT INTO organizations(code,name,status) VALUES($1,$2,'ACTIVE') RETURNING id",
      [`DM-${token}`, `Dashboard Metrics ${token}`],
    )
  ).rows[0].id;
  const userId = (
    await db.query(
      "INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status) VALUES($1,'Dashboard','Auditor',$2,'unused','ACTIVE') RETURNING id",
      [organizationId, `dashboard-${token}@test.local`],
    )
  ).rows[0].id;
  const projectId = (
    await db.query(
      "INSERT INTO projects(organization_id,code,name,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4) RETURNING id",
      [organizationId, `DMP-${token}`, `Dashboard Metrics ${token}`, userId],
    )
  ).rows[0].id;
  const location = (
    await db.query(
      "SELECT s.id state_id,l.id lga_id FROM states s JOIN lgas l ON l.state_id=s.id ORDER BY s.name,l.name LIMIT 1",
    )
  ).rows[0];
  if (!location) throw new Error("Acceptance database requires migrated geography");

  const actor = {
    id: userId,
    organization_id: organizationId,
    roles: ["SUPER_ADMIN"],
  };
  const groupScope = (groupIds) => ({
    scopeType: "GROUPS",
    groupId: null,
    groupIds,
  });
  const memberNumbers = new Map();

  async function createGroup(name) {
    const code = nextKey("GROUP").toUpperCase();
    return (
      await db.query(
        `INSERT INTO vsla_groups(
          organization_id,project_id,group_code,name,state_id,lga_id,date_formed,
          meeting_location,group_type,status,created_by,operation_mode
        ) VALUES($1,$2,$3,$4,$5,$6,'2025-01-01','Acceptance hall','SELF_MANAGED','ACTIVE',$7,'PROGRAM_ASSISTED')
        RETURNING id,group_code,name`,
        [
          organizationId,
          projectId,
          code,
          name,
          location.state_id,
          location.lga_id,
          userId,
        ],
      )
    ).rows[0];
  }

  async function createConstitution(groupId) {
    return (
      await db.query(
        `INSERT INTO group_constitutions(
          organization_id,group_id,version_number,status,share_value,
          min_shares_per_meeting,max_shares_per_meeting,social_fund_contribution,
          loan_max_multiple,loan_service_charge_rate,loan_max_term_months,
          meeting_frequency,approved_at,approved_by,created_by
        ) VALUES($1,$2,1,'APPROVED',1000,1,5,1000,3,5,3,'WEEKLY',now(),$3,$3)
        RETURNING id`,
        [organizationId, groupId, userId],
      )
    ).rows[0].id;
  }

  async function createCycle(groupId, constitutionId, number, status) {
    const year = 2024 + number;
    return (
      await db.query(
        `INSERT INTO vsla_cycles(
          organization_id,group_id,constitution_id,cycle_number,start_date,
          expected_end_date,status,created_by,activated_at,closed_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7::varchar,$8,
          CASE WHEN $7::varchar IN ('ACTIVE','CLOSING','CLOSED') THEN now() END,
          CASE WHEN $7::varchar='CLOSED' THEN now() END)
        RETURNING id,group_id,cycle_number,status`,
        [
          organizationId,
          groupId,
          constitutionId,
          number,
          `${year}-01-01`,
          `${year}-12-31`,
          status,
          userId,
        ],
      )
    ).rows[0];
  }

  async function ensureAccounts(groupId, cycleId) {
    await db.query(
      `INSERT INTO ledger_accounts(
        organization_id,group_id,cycle_id,account_code,account_name,
        account_category,normal_side,fund_type
      ) SELECT $1,$2,$3,v.code,v.name,v.category,v.side,v.fund FROM (VALUES
        ('SAVINGS_LOAN_CASH','Savings/Loan Cash','ASSET','DEBIT','SAVINGS_LOAN'),
        ('MEMBER_SAVINGS_CONTROL','Member Savings Control','EQUITY','CREDIT','SAVINGS_LOAN'),
        ('SOCIAL_FUND_CASH','Social Fund Cash','ASSET','DEBIT','SOCIAL_FUND'),
        ('SOCIAL_FUND_CONTROL','Social Fund Control','EQUITY','CREDIT','SOCIAL_FUND'),
        ('LOANS_RECEIVABLE','Loans Receivable','ASSET','DEBIT','SAVINGS_LOAN'),
        ('SHAREOUT_PAYABLE','Share-Out Payable','LIABILITY','CREDIT','SAVINGS_LOAN')
      ) v(code,name,category,side,fund)
      ON CONFLICT(cycle_id,account_code) DO NOTHING`,
      [organizationId, groupId, cycleId],
    );
    return Object.fromEntries(
      (
        await db.query(
          "SELECT account_code,id FROM ledger_accounts WHERE cycle_id=$1",
          [cycleId],
        )
      ).rows.map((row) => [row.account_code, row.id]),
    );
  }

  async function createMember(group, firstName = "Metric") {
    const number = (memberNumbers.get(group.id) || 0) + 1;
    memberNumbers.set(group.id, number);
    return (
      await db.query(
        `INSERT INTO group_members(
          organization_id,group_id,member_number,member_code,first_name,last_name,
          date_joined,status,created_by
        ) VALUES($1,$2,$3,$4,$5,'Member','2025-01-01','ACTIVE',$6) RETURNING id`,
        [
          organizationId,
          group.id,
          number,
          `${group.group_code}-M${number}`,
          firstName,
          userId,
        ],
      )
    ).rows[0].id;
  }

  async function addParticipation(groupId, cycleId, memberId, startDate) {
    await db.query(
      `INSERT INTO cycle_memberships(
        organization_id,group_id,cycle_id,member_id,participation_start_date,created_by
      ) VALUES($1,$2,$3,$4,$5,$6)`,
      [organizationId, groupId, cycleId, memberId, startDate, userId],
    );
  }

  async function createMeeting(groupId, cycle, status = "CLOSED") {
    return (
      await db.query(
        `INSERT INTO vsla_meetings(
          organization_id,group_id,cycle_id,meeting_number,meeting_code,
          meeting_date,status,opened_by,closed_by,closed_at
        ) VALUES($1,$2,$3,1,$4,$5,$6::varchar,$7::uuid,
          CASE WHEN $6::varchar='CLOSED' THEN $7::uuid END,
          CASE WHEN $6::varchar='CLOSED' THEN now() END)
        RETURNING id,meeting_date`,
        [
          organizationId,
          groupId,
          cycle.id,
          nextKey("MEETING").toUpperCase(),
          `${2024 + cycle.cycle_number}-06-01`,
          status,
          userId,
        ],
      )
    ).rows[0];
  }

  async function addAttendance(context) {
    await db.query(
      `INSERT INTO meeting_attendance(
        organization_id,meeting_id,group_id,cycle_id,member_id,attendance_status
      ) VALUES($1,$2,$3,$4,$5,'PRESENT')`,
      [
        organizationId,
        context.meeting.id,
        context.group.id,
        context.cycle.id,
        context.memberId,
      ],
    );
  }

  async function createHeader({
    groupId,
    cycleId,
    meetingId,
    memberId = null,
    transactionType,
    reversalOf = null,
  }) {
    const key = nextKey("TX");
    return (
      await db.query(
        `INSERT INTO financial_transactions(
          organization_id,group_id,cycle_id,meeting_id,member_id,transaction_type,
          reference_code,effective_date,reversal_of_transaction_id,idempotency_key,
          request_fingerprint,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,'2026-01-01',$8,$9,$10,$11) RETURNING id`,
        [
          organizationId,
          groupId,
          cycleId,
          meetingId,
          memberId,
          transactionType,
          key.toUpperCase(),
          reversalOf,
          key,
          fingerprint(key),
          userId,
        ],
      )
    ).rows[0];
  }

  async function addBalancedEntries(transactionId, debitAccount, creditAccount, amount) {
    await db.query(
      `INSERT INTO ledger_entries(
        financial_transaction_id,ledger_account_id,entry_side,amount
      ) VALUES($1,$2,'DEBIT',$4),($1,$3,'CREDIT',$4)`,
      [transactionId, debitAccount, creditAccount, amount],
    );
  }

  async function postSavings(context, amount, original = null) {
    const reversal = Boolean(original);
    const transaction = await createHeader({
      groupId: context.group.id,
      cycleId: context.cycle.id,
      meetingId: context.meeting.id,
      memberId: context.memberId,
      transactionType: reversal ? "SAVINGS_REVERSAL" : "SAVINGS_PURCHASE",
      reversalOf: original?.financialTransactionId || null,
    });
    await addBalancedEntries(
      transaction.id,
      reversal ? context.accounts.MEMBER_SAVINGS_CONTROL : context.accounts.SAVINGS_LOAN_CASH,
      reversal ? context.accounts.SAVINGS_LOAN_CASH : context.accounts.MEMBER_SAVINGS_CONTROL,
      amount,
    );
    return (
      await db.query(
        `INSERT INTO savings_transactions(
          financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,
          member_id,transaction_kind,shares,share_value,amount,
          original_savings_transaction_id,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1000,$9,$10,$11)
        RETURNING id,financial_transaction_id AS "financialTransactionId",shares,amount`,
        [
          transaction.id,
          organizationId,
          context.group.id,
          context.cycle.id,
          context.meeting.id,
          context.memberId,
          reversal ? "REVERSAL" : "PURCHASE",
          reversal ? original.shares : Number(amount) / 1000,
          amount,
          original?.id || null,
          userId,
        ],
      )
    ).rows[0];
  }

  async function postSocialFund(context, amount, original = null) {
    const reversal = Boolean(original);
    const transaction = await createHeader({
      groupId: context.group.id,
      cycleId: context.cycle.id,
      meetingId: context.meeting.id,
      memberId: context.memberId,
      transactionType: reversal
        ? "SOCIAL_FUND_REVERSAL"
        : "SOCIAL_FUND_CONTRIBUTION",
      reversalOf: original?.financialTransactionId || null,
    });
    await addBalancedEntries(
      transaction.id,
      reversal ? context.accounts.SOCIAL_FUND_CONTROL : context.accounts.SOCIAL_FUND_CASH,
      reversal ? context.accounts.SOCIAL_FUND_CASH : context.accounts.SOCIAL_FUND_CONTROL,
      amount,
    );
    return (
      await db.query(
        `INSERT INTO social_fund_transactions(
          financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,
          member_id,transaction_kind,amount,original_social_fund_transaction_id,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,financial_transaction_id AS "financialTransactionId",amount`,
        [
          transaction.id,
          organizationId,
          context.group.id,
          context.cycle.id,
          context.meeting.id,
          context.memberId,
          reversal ? "REVERSAL" : "CONTRIBUTION",
          amount,
          original?.id || null,
          userId,
        ],
      )
    ).rows[0];
  }

  async function carrySocialFund(source, target, amount) {
    const carryOut = await createHeader({
      groupId: source.group.id,
      cycleId: source.cycle.id,
      meetingId: null,
      transactionType: "SOCIAL_FUND_CARRY_FORWARD_OUT",
    });
    const carryIn = await createHeader({
      groupId: target.group.id,
      cycleId: target.cycle.id,
      meetingId: null,
      transactionType: "SOCIAL_FUND_CARRY_FORWARD_IN",
    });
    await addBalancedEntries(
      carryOut.id,
      source.accounts.SOCIAL_FUND_CONTROL,
      source.accounts.SOCIAL_FUND_CASH,
      amount,
    );
    await addBalancedEntries(
      carryIn.id,
      target.accounts.SOCIAL_FUND_CASH,
      target.accounts.SOCIAL_FUND_CONTROL,
      amount,
    );
    await db.query(
      `INSERT INTO cycle_social_fund_transfers(
        organization_id,group_id,source_cycle_id,target_cycle_id,amount,
        source_financial_transaction_id,target_financial_transaction_id,
        idempotency_key,request_fingerprint,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        organizationId,
        source.group.id,
        source.cycle.id,
        target.cycle.id,
        amount,
        carryOut.id,
        carryIn.id,
        nextKey("CARRY"),
        fingerprint(`carry-${token}-${sequence}`),
        userId,
      ],
    );
  }

  async function setupTwoCycleGroup(name) {
    const group = await createGroup(name);
    const constitutionId = await createConstitution(group.id);
    const closedCycle = await createCycle(group.id, constitutionId, 1, "CLOSED");
    const activeCycle = await createCycle(group.id, constitutionId, 2, "ACTIVE");
    const memberId = await createMember(group);
    await addParticipation(group.id, closedCycle.id, memberId, "2025-01-01");
    await addParticipation(group.id, activeCycle.id, memberId, "2026-01-01");
    const closed = {
      group,
      cycle: closedCycle,
      meeting: await createMeeting(group.id, closedCycle),
      accounts: await ensureAccounts(group.id, closedCycle.id),
      memberId,
    };
    const active = {
      group,
      cycle: activeCycle,
      meeting: await createMeeting(group.id, activeCycle),
      accounts: await ensureAccounts(group.id, activeCycle.id),
      memberId,
    };
    await addAttendance(closed);
    await addAttendance(active);
    return { group, closed, active, memberId };
  }

  const primary = await setupTwoCycleGroup("Lifetime and Current Group");
  await postSavings(primary.closed, "500000.00");

  const reclassification = await createHeader({
    groupId: primary.group.id,
    cycleId: primary.closed.cycle.id,
    meetingId: primary.closed.meeting.id,
    transactionType: "SHAREOUT_RECLASSIFICATION",
  });
  await addBalancedEntries(
    reclassification.id,
    primary.closed.accounts.MEMBER_SAVINGS_CONTROL,
    primary.closed.accounts.SHAREOUT_PAYABLE,
    "500000.00",
  );
  const payout = await createHeader({
    groupId: primary.group.id,
    cycleId: primary.closed.cycle.id,
    meetingId: primary.closed.meeting.id,
    transactionType: "SHAREOUT_PAYOUT",
  });
  await addBalancedEntries(
    payout.id,
    primary.closed.accounts.SHAREOUT_PAYABLE,
    primary.closed.accounts.SAVINGS_LOAN_CASH,
    "500000.00",
  );

  const correctionMember = await createMember(primary.group, "Correction");
  await addParticipation(
    primary.group.id,
    primary.closed.cycle.id,
    correctionMember,
    "2025-01-01",
  );
  await addParticipation(
    primary.group.id,
    primary.active.cycle.id,
    correctionMember,
    "2026-01-01",
  );
  const primaryClosedCorrection = {
    ...primary.closed,
    memberId: correctionMember,
  };
  const primaryActiveCorrection = {
    ...primary.active,
    memberId: correctionMember,
  };
  await addAttendance(primaryClosedCorrection);
  await addAttendance(primaryActiveCorrection);

  await postSavings(primary.active, "110000.00");
  const reversedSavings = await postSavings(
    primaryActiveCorrection,
    "10000.00",
  );
  await postSavings(primaryActiveCorrection, "10000.00", reversedSavings);

  await postSocialFund(primary.closed, "48000.00");
  const reversedSocial = await postSocialFund(
    primaryClosedCorrection,
    "2000.00",
  );
  await postSocialFund(
    primaryClosedCorrection,
    "2000.00",
    reversedSocial,
  );
  await postSocialFund(primary.active, "15000.00");

  await carrySocialFund(primary.closed, primary.active, "40000.00");

  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  await db.query("SET CONSTRAINTS ALL DEFERRED");
  const primaryMetrics = await dashboardMetrics(
    db,
    actor,
    groupScope([primary.group.id]),
  );
  expectMoney(primaryMetrics, "total_savings_ever", "610000.00", "primary");
  expectMoney(primaryMetrics, "current_cycle_savings", "110000.00", "primary");
  expectMoney(
    primaryMetrics,
    "total_social_fund_contributions",
    "63000.00",
    "primary",
  );
  expectMoney(
    primaryMetrics,
    "current_social_fund_balance",
    "55000.00",
    "primary",
  );
  const closedSavingsCash = (
    await db.query(
      `SELECT COALESCE(SUM(CASE le.entry_side WHEN 'DEBIT' THEN le.amount ELSE -le.amount END),0)::numeric(18,2) balance
       FROM ledger_accounts la LEFT JOIN ledger_entries le ON le.ledger_account_id=la.id
       WHERE la.cycle_id=$1 AND la.account_code='SAVINGS_LOAN_CASH'`,
      [primary.closed.cycle.id],
    )
  ).rows[0].balance;
  assert.equal(closedSavingsCash, "0.00");
  assert.equal(
    (
      await db.query(
        "SELECT COUNT(*)::int count FROM cycle_social_fund_transfers WHERE group_id=$1",
        [primary.group.id],
      )
    ).rows[0].count,
    1,
  );
  results.push({
    scenario: "lifetime/current savings and Social Fund carry-forward",
    result: "PASS",
    metrics: primaryMetrics,
    closedCycleSavingsCash: closedSavingsCash,
  });

  const carryRegression = await setupTwoCycleGroup(
    "Carry-Forward Double-Count Regression",
  );
  await postSocialFund(carryRegression.closed, "20000.00");
  await carrySocialFund(
    carryRegression.closed,
    carryRegression.active,
    "20000.00",
  );
  await postSocialFund(carryRegression.active, "5000.00");
  const carryRegressionMetrics = await dashboardMetrics(
    db,
    actor,
    groupScope([carryRegression.group.id]),
  );
  expectMoney(
    carryRegressionMetrics,
    "total_social_fund_contributions",
    "25000.00",
    "carry-forward regression",
  );
  expectMoney(
    carryRegressionMetrics,
    "current_social_fund_balance",
    "25000.00",
    "carry-forward regression",
  );
  assert.notEqual(
    carryRegressionMetrics.total_social_fund_contributions,
    "45000.00",
  );
  results.push({
    scenario: "dedicated Social Fund carry-forward double-count protection",
    result: "PASS",
    cycle1Contributions: "20000.00",
    amountCarried: "20000.00",
    cycle2Contributions: "5000.00",
    metrics: carryRegressionMetrics,
  });

  const reversalGroup = await createGroup("Reversal Group");
  const reversalConstitution = await createConstitution(reversalGroup.id);
  const closingCycle = await createCycle(
    reversalGroup.id,
    reversalConstitution,
    1,
    "CLOSING",
  );
  const reversalMember = await createMember(reversalGroup, "Correction");
  await addParticipation(
    reversalGroup.id,
    closingCycle.id,
    reversalMember,
    "2025-01-01",
  );
  const reversalContext = {
    group: reversalGroup,
    cycle: closingCycle,
    meeting: await createMeeting(reversalGroup.id, closingCycle),
    accounts: await ensureAccounts(reversalGroup.id, closingCycle.id),
    memberId: reversalMember,
  };
  await addAttendance(reversalContext);
  const originalSaving = await postSavings(reversalContext, "10000.00");
  await postSavings(reversalContext, "10000.00", originalSaving);
  await postSavings(reversalContext, "8000.00");
  const originalContribution = await postSocialFund(reversalContext, "1000.00");
  await postSocialFund(reversalContext, "1000.00", originalContribution);
  await postSocialFund(reversalContext, "500.00");
  const reversalMetrics = await dashboardMetrics(
    db,
    actor,
    groupScope([reversalGroup.id]),
  );
  expectMoney(reversalMetrics, "total_savings_ever", "8000.00", "reversal");
  expectMoney(reversalMetrics, "current_cycle_savings", "0.00", "reversal");
  expectMoney(
    reversalMetrics,
    "total_social_fund_contributions",
    "500.00",
    "reversal",
  );
  expectMoney(
    reversalMetrics,
    "current_social_fund_balance",
    "0.00",
    "reversal",
  );
  results.push({
    scenario: "linked reversals, corrections, and CLOSING-cycle lifetime inclusion",
    result: "PASS",
    metrics: reversalMetrics,
  });

  const groupA = await setupTwoCycleGroup("Multiple Group A");
  const groupB = await setupTwoCycleGroup("Multiple Group B");
  await postSavings(groupA.closed, "40000.00");
  await postSavings(groupA.active, "30000.00");
  await postSavings(groupB.closed, "25000.00");
  await postSavings(groupB.active, "15000.00");
  await postSocialFund(groupA.closed, "20000.00");
  await postSocialFund(groupA.active, "7000.00");
  await postSocialFund(groupB.closed, "10000.00");
  await postSocialFund(groupB.active, "3000.00");
  const portfolioMetrics = await dashboardMetrics(
    db,
    actor,
    groupScope([groupA.group.id, groupB.group.id]),
  );
  expectMoney(
    portfolioMetrics,
    "total_savings_ever",
    "110000.00",
    "portfolio",
  );
  expectMoney(
    portfolioMetrics,
    "current_cycle_savings",
    "45000.00",
    "portfolio",
  );
  expectMoney(
    portfolioMetrics,
    "total_social_fund_contributions",
    "40000.00",
    "portfolio",
  );
  expectMoney(
    portfolioMetrics,
    "current_social_fund_balance",
    "10000.00",
    "portfolio",
  );
  const multiCycleParticipants = (
    await db.query(
      `SELECT COUNT(*)::int count FROM (
        SELECT group_id,member_id FROM cycle_memberships
        WHERE group_id=ANY($1::uuid[])
        GROUP BY group_id,member_id HAVING COUNT(*)=2
      ) participants`,
      [[groupA.group.id, groupB.group.id]],
    )
  ).rows[0].count;
  assert.equal(multiCycleParticipants, 2);
  results.push({
    scenario: "multiple groups/cycles without cycle-membership row multiplication",
    result: "PASS",
    metrics: portfolioMetrics,
    membersParticipatingInTwoCycles: multiCycleParticipants,
  });

  await db.query(
    "UPDATE vsla_cycles SET status='CLOSED',closed_at=now() WHERE id=$1",
    [primary.active.cycle.id],
  );
  const closedOnlyMetrics = await dashboardMetrics(
    db,
    actor,
    groupScope([primary.group.id]),
  );
  expectMoney(
    closedOnlyMetrics,
    "total_savings_ever",
    "610000.00",
    "closed only",
  );
  expectMoney(
    closedOnlyMetrics,
    "current_cycle_savings",
    "0.00",
    "closed only",
  );
  expectMoney(
    closedOnlyMetrics,
    "total_social_fund_contributions",
    "63000.00",
    "closed only",
  );
  expectMoney(
    closedOnlyMetrics,
    "current_social_fund_balance",
    "0.00",
    "closed only",
  );
  results.push({
    scenario: "all cycles closed",
    result: "PASS",
    metrics: closedOnlyMetrics,
  });

  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  console.log(JSON.stringify({ database, rolledBack: true, results }, null, 2));
} finally {
  if (transactionOpen) await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
