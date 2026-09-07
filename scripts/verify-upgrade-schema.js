import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (database !== "cccrn_vsla_upgrade_acceptance") throw new Error(`Refusing upgrade validation against ${database}`);
const stage = process.argv[2];
if (!['before-034','after-034'].includes(stage)) throw new Error('Expected before-034 or after-034');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const migrations = (await db.query("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map(row => row.filename);
  const relation = async name => (await db.query("SELECT to_regclass($1) AS relation_name", [`public.${name}`])).rows[0].relation_name;
  const trigger = async name => (await db.query("SELECT COUNT(*)::int count FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal", [name])).rows[0].count;
  const permission = (await db.query("SELECT COUNT(*)::int count FROM permissions WHERE code='group.archive'")).rows[0].count;
  const evidence = {
    database,
    stage,
    migrationCount: migrations.length,
    latestMigration: migrations.at(-1),
    reconciliationSignatures: await relation('reconciliation_signatures'),
    constitutionDocuments: await relation('constitution_documents'),
    savingsGuard: await trigger('one_active_savings_purchase_per_member_meeting'),
    socialFundGuard: await trigger('one_active_social_contribution_per_member_meeting'),
    archivePermission: permission,
  };
  if (stage === 'before-034') {
    if (migrations.length !== 33 || evidence.reconciliationSignatures || evidence.constitutionDocuments || evidence.savingsGuard || permission) throw new Error(`Invalid pre-034 state: ${JSON.stringify(evidence)}`);
  } else {
    if (migrations.length !== 34 || !evidence.reconciliationSignatures || !evidence.constitutionDocuments || evidence.savingsGuard !== 1 || evidence.socialFundGuard !== 1 || permission !== 1) throw new Error(`Invalid post-034 state: ${JSON.stringify(evidence)}`);
    const brokenForeignKeys = (await db.query(`SELECT COUNT(*)::int count FROM pg_constraint c WHERE c.contype='f' AND c.conrelid IN ('reconciliation_signatures'::regclass,'constitution_documents'::regclass) AND NOT c.convalidated`)).rows[0].count;
    evidence.unvalidatedForeignKeys = brokenForeignKeys;
    if (brokenForeignKeys) throw new Error(`Unvalidated 034 foreign keys: ${brokenForeignKeys}`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally { await db.end(); }
