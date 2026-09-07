import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const expected = [
  "constitution.approve", "constitution.manage", "constitution.view",
  "cycle.close", "cycle.manage", "cycle.view", "fine.record", "fine.view", "financial.reverse",
  "group.activate", "group.create", "group.update", "group.view", "group_operation_mode.view", "group_public.manage",
  "join_request.convert", "join_request.manage", "join_request.view",
  "loan.approve", "loan.default", "loan.disburse", "loan.repay", "loan.request", "loan.reverse", "loan.view",
  "meeting.create", "meeting.manage", "meeting.view", "member.create", "member.update", "member.view",
  "member_access.manage", "member_access.view", "notification.view", "officer.manage", "officer.view", "project.view",
  "savings.record", "savings.view", "shareout.approve", "shareout.payout", "shareout.prepare", "shareout.reverse", "shareout.view",
  "social_fund.carry_forward", "social_fund.record", "social_fund.view",
].sort();
const forbidden = [
  "facilitator.assign_groups", "facilitator.create", "facilitator.update",
  "facilitator.activate", "facilitator.deactivate", "group_operation_mode.manage",
];
const source = new URL(process.env.DATABASE_URL);
const database = `vsla_rbac_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const maintenanceUrl = new URL(source);
maintenanceUrl.pathname = "/postgres";
const fixtureUrl = new URL(source);
fixtureUrl.pathname = `/${database}`;
const admin = new pg.Client({ connectionString: maintenanceUrl.toString() });
let fixture;

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  fixture = new pg.Client({ connectionString: fixtureUrl.toString() });
  await fixture.connect();
  const migrationDir = path.join(process.cwd(), "database", "migrations");
  for (const file of (await fs.readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await fixture.query(await fs.readFile(path.join(migrationDir, file), "utf8"));
  }
  await fixture.query(await fs.readFile(path.join(process.cwd(), "database", "seeds", "001_roles_permissions.sql"), "utf8"));
  const actual = (await fixture.query(`SELECT p.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code='FACILITATOR' ORDER BY p.code`)).rows.map((row) => row.code);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FACILITATOR matrix mismatch\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  const leaked = actual.filter((permission) => forbidden.includes(permission));
  if (leaked.length) throw new Error(`Administrative permissions leaked: ${leaked.join(", ")}`);
  console.log(JSON.stringify({ freshDatabase: true, facilitatorPermissions: actual, forbiddenPermissionsPresent: leaked, result: "PASS" }, null, 2));
} finally {
  if (fixture) await fixture.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {});
  await admin.end();
}
