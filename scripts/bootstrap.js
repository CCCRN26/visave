import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
function required(name, fallback) {
  const value = String(process.env[name] || fallback || "").trim();
  if (!value) throw new Error(`BOOTSTRAP_CONFIG_INVALID: ${name} is required`);
  return value;
}
function configuration() {
  const value = {
    organizationName: required("BOOTSTRAP_ORG_NAME"), organizationCode: required("BOOTSTRAP_ORG_CODE").toUpperCase(),
    firstName: required("BOOTSTRAP_ADMIN_FIRST_NAME", "System"), lastName: required("BOOTSTRAP_ADMIN_LAST_NAME", "Administrator"),
    email: required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase(), password: required("BOOTSTRAP_ADMIN_PASSWORD"),
  };
  if (value.organizationName.length > 160) throw new Error("BOOTSTRAP_CONFIG_INVALID: organization name is too long");
  if (!/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(value.organizationCode)) throw new Error("BOOTSTRAP_CONFIG_INVALID: organization code is invalid");
  if (value.firstName.length > 100 || value.lastName.length > 100) throw new Error("BOOTSTRAP_CONFIG_INVALID: administrator name is too long");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254) throw new Error("BOOTSTRAP_CONFIG_INVALID: administrator email is invalid");
  if (value.password.length < 12 || value.password.length > 128) throw new Error("BOOTSTRAP_CONFIG_INVALID: administrator password must be 12-128 characters");
  return value;
}

const databaseUrl = required("DATABASE_URL");
const config = configuration();
const target = new URL(databaseUrl);
console.log("VSLA Foundation Bootstrap");
console.log(`Database: ${target.pathname.slice(1)}`);
console.log(`Organization: ${config.organizationCode}`);
console.log(`Administrator: ${config.email}`);

const client = new pg.Client({ connectionString: databaseUrl });
let transactionStarted = false;
try {
  await client.connect();
  await client.query("BEGIN");
  transactionStarted = true;
  const migrationFiles = (await fs.readdir(path.join(process.cwd(), "database", "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  const applied = new Set((await client.query("SELECT filename FROM schema_migrations")).rows.map((row) => row.filename));
  const missing = migrationFiles.filter((name) => !applied.has(name));
  if (missing.length) throw new Error(`BOOTSTRAP_REFUSED_MIGRATIONS_INCOMPLETE: ${missing.join(", ")}`);

  for (const table of ["vsla_groups", "group_members", "vsla_cycles", "vsla_meetings", "financial_transactions", "ledger_entries", "loans", "cycle_shareouts"]) {
    const count = Number((await client.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count);
    if (count > 0) throw new Error(`BOOTSTRAP_REFUSED_DATABASE_NOT_FRESH: ${table} contains ${count} row(s)`);
  }

  const bootstrapDirectory = path.join(process.cwd(), "database", "bootstrap");
  for (const file of (await fs.readdir(bootstrapDirectory)).filter((name) => name.endsWith(".sql")).sort()) {
    await client.query(await fs.readFile(path.join(bootstrapDirectory, file), "utf8"));
    console.log(`Bootstrapped ${file}`);
  }
  const role = (await client.query("SELECT id FROM roles WHERE code='SUPER_ADMIN'")).rows[0];
  if (!role) throw new Error("BOOTSTRAP_RBAC_INVALID: SUPER_ADMIN role is missing");
  const rbac = (await client.query(`SELECT (SELECT COUNT(*)::int FROM permissions) permission_count,
    (SELECT COUNT(*)::int FROM role_permissions WHERE role_id=$1) super_admin_permission_count`, [role.id])).rows[0];
  if (!rbac.permission_count || rbac.super_admin_permission_count !== rbac.permission_count) throw new Error("BOOTSTRAP_RBAC_INVALID: SUPER_ADMIN permission matrix is incomplete");

  const organizations = (await client.query("SELECT * FROM organizations ORDER BY created_at FOR UPDATE")).rows;
  const users = (await client.query("SELECT * FROM users ORDER BY created_at FOR UPDATE")).rows;
  if (organizations.length || users.length) {
    const organization = organizations.find((row) => row.code === config.organizationCode);
    const administrator = users.find((row) => row.email?.toLowerCase() === config.email);
    if (organizations.length !== 1 || users.length !== 1 || !organization || organization.name !== config.organizationName || organization.status !== "ACTIVE" ||
      !administrator || administrator.organization_id !== organization.id || administrator.first_name !== config.firstName || administrator.last_name !== config.lastName || administrator.status !== "ACTIVE") {
      throw new Error("BOOTSTRAP_CONFLICT_EXISTING_FOUNDATION_DATA");
    }
    const assignments = Number((await client.query(`SELECT COUNT(*) AS count FROM user_roles
      WHERE user_id=$1 AND role_id=$2 AND project_id IS NULL AND state_id IS NULL`, [administrator.id, role.id])).rows[0].count);
    if (assignments !== 1) throw new Error("BOOTSTRAP_CONFLICT_SUPER_ADMIN_ASSIGNMENT");
    await client.query("COMMIT");
    transactionStarted = false;
    console.log("Bootstrap already completed — no changes made.");
  } else {
    const organization = (await client.query(`INSERT INTO organizations(code,name,status) VALUES($1,$2,'ACTIVE') RETURNING id`, [config.organizationCode, config.organizationName])).rows[0];
    const hash = await bcrypt.hash(config.password, 12);
    const administrator = (await client.query(`INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status,must_change_password)
      VALUES($1,$2,$3,$4,$5,'ACTIVE',false) RETURNING id`, [organization.id, config.firstName, config.lastName, config.email, hash])).rows[0];
    await client.query("INSERT INTO user_roles(user_id,role_id,project_id,state_id,created_by) VALUES($1,$2,NULL,NULL,$1)", [administrator.id, role.id]);
    await client.query("COMMIT");
    transactionStarted = false;
    console.log("Foundation bootstrap complete: organization and SUPER_ADMIN created; no demo data added.");
  }
} catch (error) {
  if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
