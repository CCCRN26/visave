import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dashboardMetrics } from "../src/modules/dashboard/dashboard.repository.js";

async function metricsSql() {
  let sql = "";
  let values = [];
  const client = {
    query: async (text, params) => {
      sql = text;
      values = params;
      return { rows: [{}] };
    },
  };
  const user = {
    id: "user-1",
    organization_id: "organization-1",
    roles: ["SUPER_ADMIN"],
  };
  await dashboardMetrics(client, user, { scopeType: "GROUPS", groupIds: [] });
  return { sql, values };
}

function cte(sql, start, end) {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `Missing ${start}`);
  assert.notEqual(to, -1, `Missing ${end}`);
  return sql.slice(from, to);
}

test("dashboard financial metrics use explicit lifetime and active-cycle flow semantics", async () => {
  const { sql, values } = await metricsSql();
  const relevantCycles = cte(sql, "relevant_cycles AS", "active_cycles AS");
  const lifetimeSavings = cte(sql, "lifetime_savings AS", "current_cycle_savings AS");
  const currentSavings = cte(sql, "current_cycle_savings AS", "lifetime_social_fund_contributions AS");
  const lifetimeSocialFund = cte(sql, "lifetime_social_fund_contributions AS", ")\n     SELECT");

  assert.match(relevantCycles, /status IN \('ACTIVE','CLOSING','CLOSED'\)/);
  assert.doesNotMatch(relevantCycles, /DRAFT|READY|CANCELLED/);
  assert.match(sql, /active_cycles AS[\s\S]*status='ACTIVE'/);

  assert.match(lifetimeSavings, /WHEN 'PURCHASE' THEN st\.amount[\s\S]*WHEN 'REVERSAL' THEN -st\.amount[\s\S]*ELSE 0/);
  assert.match(lifetimeSavings, /JOIN relevant_cycles rc ON rc\.id=st\.cycle_id AND rc\.group_id=st\.group_id/);
  assert.match(currentSavings, /WHEN 'PURCHASE' THEN st\.amount[\s\S]*WHEN 'REVERSAL' THEN -st\.amount[\s\S]*ELSE 0/);
  assert.match(currentSavings, /JOIN active_cycles ac ON ac\.id=st\.cycle_id AND ac\.group_id=st\.group_id/);
  assert.doesNotMatch(`${lifetimeSavings}${currentSavings}`, /ELSE -st\.amount/);

  assert.match(lifetimeSocialFund, /FROM social_fund_transactions sf/);
  assert.match(lifetimeSocialFund, /WHEN 'CONTRIBUTION' THEN sf\.amount[\s\S]*WHEN 'REVERSAL' THEN -sf\.amount[\s\S]*ELSE 0/);
  assert.match(lifetimeSocialFund, /JOIN relevant_cycles rc ON rc\.id=sf\.cycle_id AND rc\.group_id=sf\.group_id/);
  assert.doesNotMatch(lifetimeSocialFund, /ledger|cycle_social_fund_transfers|CARRY_FORWARD/i);

  assert.equal((sql.match(/cycle_memberships/g) || []).length, 1, "financial CTEs must not multiply rows through cycle participation");
  assert.match(sql, /total_savings_ever/);
  assert.match(sql, /current_cycle_savings/);
  assert.match(sql, /total_social_fund_contributions/);
  assert.match(sql, /current_social_fund_balance/);
  assert.match(sql, /account_code='LOANS_RECEIVABLE'/);
  assert.deepEqual(values, ["organization-1", "user-1", ["SUPER_ADMIN"], "GROUPS", []]);
});

test("dashboard labels distinguish lifetime flows from active-cycle values", () => {
  const view = fs.readFileSync("src/components/dashboard-view.js", "utf8");
  const css = fs.readFileSync("src/app/globals.css", "utf8");

  for (const field of [
    "total_savings_ever",
    "current_cycle_savings",
    "total_social_fund_contributions",
    "current_social_fund_balance",
  ]) assert.match(view, new RegExp(`metrics\\.${field}`));

  for (const label of [
    "Total Savings Ever",
    "Current Cycle Savings",
    "Total Social Fund Contributions",
    "Current Social Fund Balance",
  ]) assert.match(view, new RegExp(label));

  assert.match(view, /Net member savings across all completed and current cycles\./);
  assert.match(view, /Net savings in currently active cycles\./);
  assert.match(view, /Carry-forward is not counted again\./);
  assert.match(view, /Social Fund currently available in active cycles\./);
  assert.doesNotMatch(view, /metrics\.total_savings\b/);
  assert.doesNotMatch(view, /metrics\.social_fund\b/);
  assert.match(css, /dashboard-financial-groups/);
  assert.match(css, /@media\(max-width:1100px\).*dashboard-financial-groups/);
  assert.match(css, /@media\(max-width:650px\).*dashboard-financial-pair/);
});

test("pgAdmin reconciliation SQL mirrors all four dashboard definitions", () => {
  const sql = fs.readFileSync("database/diagnostics/dashboard_financial_metrics.sql", "utf8");
  assert.match(sql, /TOTAL SAVINGS EVER/);
  assert.match(sql, /CURRENT CYCLE SAVINGS/);
  assert.match(sql, /TOTAL SOCIAL FUND CONTRIBUTIONS/);
  assert.match(sql, /CURRENT SOCIAL FUND BALANCE/);
  assert.equal((sql.match(/status IN \('ACTIVE','CLOSING','CLOSED'\)/g) || []).length, 2);
  assert.equal((sql.match(/status='ACTIVE'/g) || []).length, 2);
  assert.match(sql, /JOIN social_fund_transactions sf/);
  assert.doesNotMatch(sql, /social_fund_transactions[\s\S]{0,200}cycle_social_fund_transfers/i);
});
