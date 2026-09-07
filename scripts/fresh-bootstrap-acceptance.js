import { spawn, spawnSync } from "node:child_process";
import pg from "pg";
import nextEnv from "@next/env";
import { databaseUrlFor, requireDisposableDatabaseName } from "./lib/disposable-database.js";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const source = new URL(process.env.DATABASE_URL);
const databaseName = requireDisposableDatabaseName("cccrn_vsla_acceptance");
const incompleteDatabaseName = requireDisposableDatabaseName("cccrn_vsla_upgrade_acceptance");
const databaseUrl = databaseUrlFor(source, databaseName).toString();
const incompleteDatabaseUrl = databaseUrlFor(source, incompleteDatabaseName).toString();
const bootstrap = {
  BOOTSTRAP_ORG_NAME: "Bootstrap Acceptance Organization",
  BOOTSTRAP_ORG_CODE: "BOOTSTRAP_TEST",
  BOOTSTRAP_ADMIN_FIRST_NAME: "System",
  BOOTSTRAP_ADMIN_LAST_NAME: "Administrator",
  BOOTSTRAP_ADMIN_EMAIL: "bootstrap.admin@example.org",
  BOOTSTRAP_ADMIN_PASSWORD: "Bootstrap-Test-2026!",
};
const run = (args, env = {}, expected = 0) => {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== expected) throw new Error(`Command ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
};
const recreate = (name) => run(["scripts/acceptance-db.js", "recreate", name]);
const migrate = (url, through) => run(["scripts/migrate.js"], { DATABASE_URL: url, ...(through ? { MIGRATION_THROUGH: through } : {}) });
const boot = (url, overrides = {}, expected = 0) => run(["scripts/bootstrap.js"], { DATABASE_URL: url, ...bootstrap, ...overrides }, expected);
const expectFailure = (output, code) => { if (!output.includes(code)) throw new Error(`Expected ${code}, received:\n${output}`); };

recreate(databaseName);
migrate(databaseUrl);
const first = boot(databaseUrl);
if (!first.includes("Foundation bootstrap complete")) throw new Error("First bootstrap did not complete");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let server;
try {
  const counts = (await client.query(`SELECT
    (SELECT COUNT(*)::int FROM organizations) organizations,
    (SELECT COUNT(*)::int FROM users) users,
    (SELECT COUNT(*)::int FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.code='SUPER_ADMIN') super_admin_assignments,
    (SELECT COUNT(*)::int FROM projects) projects,
    (SELECT COUNT(*)::int FROM facilitator_profiles) facilitators,
    (SELECT COUNT(*)::int FROM vsla_groups) group_count,
    (SELECT COUNT(*)::int FROM group_members) members,
    (SELECT COUNT(*)::int FROM vsla_cycles) cycles,
    (SELECT COUNT(*)::int FROM vsla_meetings) meetings,
    (SELECT COUNT(*)::int FROM financial_transactions) financial_transactions,
    (SELECT COUNT(*)::int FROM ledger_entries) ledger_entries,
    (SELECT COUNT(*)::int FROM loans) loans,
    (SELECT COUNT(*)::int FROM cycle_shareouts) shareouts`)).rows[0];
  for (const key of ["organizations", "users", "super_admin_assignments"]) if (counts[key] !== 1) throw new Error(`${key}: expected 1, got ${counts[key]}`);
  for (const [key, value] of Object.entries(counts)) if (!["organizations", "users", "super_admin_assignments"].includes(key) && value !== 0) throw new Error(`${key}: expected 0, got ${value}`);

  const second = boot(databaseUrl);
  if (!second.includes("Bootstrap already completed — no changes made.")) throw new Error("Rerun was not recognized");
  const unchanged = (await client.query("SELECT (SELECT COUNT(*)::int FROM organizations) organizations,(SELECT COUNT(*)::int FROM users) users,(SELECT COUNT(*)::int FROM user_roles) assignments")).rows[0];
  if (unchanged.organizations !== 1 || unchanged.users !== 1 || unchanged.assignments !== 1) throw new Error("Rerun created duplicate foundation records");

  expectFailure(boot(databaseUrl, { BOOTSTRAP_ADMIN_PASSWORD: "" }, 1), "BOOTSTRAP_CONFIG_INVALID");
  expectFailure(boot(databaseUrl, { BOOTSTRAP_ADMIN_PASSWORD: "weak" }, 1), "BOOTSTRAP_CONFIG_INVALID");
  expectFailure(boot(databaseUrl, { BOOTSTRAP_ADMIN_EMAIL: "invalid-email" }, 1), "BOOTSTRAP_CONFIG_INVALID");

  const port = 3199;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { ready = true; break; } } catch {}
  }
  if (!ready) throw new Error(`Focused login server did not start\n${serverOutput}`);
  const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: bootstrap.BOOTSTRAP_ADMIN_EMAIL, password: bootstrap.BOOTSTRAP_ADMIN_PASSWORD }) });
  if (login.status !== 200 || !login.headers.get("set-cookie")) throw new Error(`Bootstrap administrator login failed: ${login.status}`);
  const auth = (await client.query(`SELECT
    (SELECT COUNT(*)::int FROM user_sessions) sessions,
    (SELECT COUNT(*)::int FROM audit_logs WHERE action='USER_LOGIN') login_audits`)).rows[0];
  if (auth.sessions !== 1 || auth.login_audits !== 1) throw new Error(`Login persistence mismatch: ${JSON.stringify(auth)}`);

  const admin = (await client.query("SELECT id,organization_id FROM users WHERE lower(email)=$1", [bootstrap.BOOTSTRAP_ADMIN_EMAIL])).rows[0];
  const project = (await client.query(`INSERT INTO projects(organization_id,code,name,status,created_by) VALUES($1,'BOOT-REFUSE','Refusal fixture','ACTIVE',$2) RETURNING id`, [admin.organization_id, admin.id])).rows[0];
  const geography = (await client.query(`SELECT s.id state_id,l.id lga_id FROM states s JOIN lgas l ON l.state_id=s.id WHERE s.country_code='NG' AND s.name='Niger' ORDER BY l.name LIMIT 1`)).rows[0];
  if (!geography) throw new Error("Bootstrap refusal fixture requires seeded Niger State/LGA geography");
  const refusalGroup = (await client.query(`INSERT INTO vsla_groups(organization_id,project_id,group_code,name,state_id,lga_id,status,created_by) VALUES($1,$2,'BOOT-REFUSE-GROUP','Refusal fixture',$3,$4,'ACTIVE',$5) RETURNING id,state_id,lga_id`, [admin.organization_id, project.id, geography.state_id, geography.lga_id, admin.id])).rows[0];
  if (!refusalGroup || refusalGroup.state_id !== geography.state_id || refusalGroup.lga_id !== geography.lga_id) throw new Error("Operational bootstrap refusal group was not persisted with valid geography");
  expectFailure(boot(databaseUrl, {}, 1), "BOOTSTRAP_REFUSED_DATABASE_NOT_FRESH");
  await client.query("DELETE FROM vsla_groups WHERE group_code='BOOT-REFUSE-GROUP'");
  await client.query("DELETE FROM projects WHERE code='BOOT-REFUSE'");

  recreate(incompleteDatabaseName);
  migrate(incompleteDatabaseUrl, "033");
  expectFailure(boot(incompleteDatabaseUrl, {}, 1), "BOOTSTRAP_REFUSED_MIGRATIONS_INCOMPLETE");
  console.log(JSON.stringify({ result: "PASS", database: databaseName, counts, login: auth, rerun: "idempotent", refusalFixture: { groupInserted: true, geographyValid: true, bootstrapRefusedOperationalData: true }, safetyFailures: "verified" }, null, 2));
} finally {
  if (server) server.kill();
  await client.end();
}
