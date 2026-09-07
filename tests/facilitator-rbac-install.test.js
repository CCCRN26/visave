import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../database/migrations/032_fresh_install_facilitator_rbac_backfill.sql", import.meta.url),
  "utf8",
);
const foundationSql = fs.readFileSync(
  new URL("../database/migrations/033_fresh_install_agent_onboarding_permissions.sql", import.meta.url),
  "utf8",
);

const required = [
  "group.create", "group.activate", "constitution.approve", "member_access.manage",
  "member_access.view", "group_operation_mode.view", "group_public.manage",
  "join_request.view", "join_request.manage", "join_request.convert", "notification.view",
  "meeting.create", "savings.record", "social_fund.record", "fine.record",
  "loan.request", "shareout.view",
];

test("fresh-install backfill creates FACILITATOR before applying current Agent permissions", () => {
  assert.match(sql, /INSERT INTO roles[\s\S]*'FACILITATOR'/);
  assert.match(sql, /ON CONFLICT\(code\) DO NOTHING/);
  for (const permission of required) assert.ok(sql.includes(`'${permission}'`), permission);
});

test("fresh-install backfill creates seed-defined Agent onboarding permissions before granting them", () => {
  for (const permission of ["group.create", "group.activate"]) {
    assert.ok(foundationSql.includes(`('${permission}'`), permission);
    assert.ok(foundationSql.includes(`'${permission}'`), permission);
  }
  assert.match(foundationSql, /ON CONFLICT\(code\) DO NOTHING/);
});

test("FACILITATOR backfill excludes administrative facilitator management", () => {
  for (const permission of [
    "facilitator.create", "facilitator.update", "facilitator.activate",
    "facilitator.deactivate", "facilitator.assign_groups", "group_operation_mode.manage",
  ]) assert.ok(!sql.includes(`'${permission}'`), permission);
});
