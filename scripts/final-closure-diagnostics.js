import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (database !== "cccrn_vsla_acceptance") throw new Error(`Refusing final diagnostics against ${database}`);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const counts = (await db.query(`
  SELECT
    (SELECT COUNT(*)::int FROM (
      SELECT s.meeting_id,s.member_id
      FROM savings_transactions s
      JOIN financial_transactions original ON original.id=s.financial_transaction_id
      WHERE s.transaction_kind='PURCHASE'
        AND NOT EXISTS (SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=original.id)
      GROUP BY s.meeting_id,s.member_id HAVING COUNT(*)>1
    ) duplicates) duplicate_savings_financial_effects,
    (SELECT COUNT(*)::int FROM (
      SELECT s.meeting_id,s.member_id
      FROM social_fund_transactions s
      JOIN financial_transactions original ON original.id=s.financial_transaction_id
      WHERE s.transaction_kind='CONTRIBUTION'
        AND NOT EXISTS (SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=original.id)
      GROUP BY s.meeting_id,s.member_id HAVING COUNT(*)>1
    ) duplicates) duplicate_social_fund_financial_effects,
    (SELECT COUNT(*)::int FROM reconciliation_signatures s
      LEFT JOIN meeting_reconciliations r ON r.id=s.reconciliation_id
      LEFT JOIN vsla_meetings m ON m.id=s.meeting_id
      LEFT JOIN vsla_groups g ON g.id=s.group_id
      LEFT JOIN organizations o ON o.id=s.organization_id
      LEFT JOIN users u ON u.id=s.signed_by_user_id
      WHERE r.id IS NULL OR m.id IS NULL OR g.id IS NULL OR o.id IS NULL OR u.id IS NULL
        OR r.meeting_id<>s.meeting_id OR m.group_id<>s.group_id OR g.organization_id<>s.organization_id
    ) orphan_reconciliation_signatures,
    (SELECT COUNT(*)::int FROM constitution_documents d
      LEFT JOIN group_constitutions c ON c.id=d.constitution_id
      LEFT JOIN vsla_groups g ON g.id=d.group_id
      LEFT JOIN organizations o ON o.id=d.organization_id
      LEFT JOIN users u ON u.id=d.uploaded_by_user_id
      LEFT JOIN constitution_documents replacement ON replacement.id=d.replaced_by_document_id
      WHERE c.id IS NULL OR g.id IS NULL OR o.id IS NULL OR u.id IS NULL
        OR c.group_id<>d.group_id OR g.organization_id<>d.organization_id
        OR (d.replaced_by_document_id IS NOT NULL AND replacement.id IS NULL)
    ) orphan_constitution_documents
`)).rows[0];
const files = (await db.query(`
  SELECT 'signature' kind,storage_key FROM reconciliation_signatures
  UNION ALL
  SELECT 'constitution' kind,storage_key FROM constitution_documents WHERE archived_at IS NULL
`)).rows;
await db.end();

const storageRoot = path.resolve(process.env.VSLA_PRIVATE_UPLOAD_ROOT || path.join(os.tmpdir(), "cccrn-vsla-private"));
let missingPrivateSignatureFiles = 0, missingPrivatePdfFiles = 0;
for (const file of files) {
  try { await fs.access(path.resolve(storageRoot, file.storage_key)); }
  catch { if (file.kind === "signature") missingPrivateSignatureFiles += 1; else missingPrivatePdfFiles += 1; }
}
const result = { database, ...counts, missing_private_signature_files:missingPrivateSignatureFiles, missing_private_pdf_files:missingPrivatePdfFiles };
console.log(JSON.stringify(result,null,2));
if (Object.entries(result).some(([key,value]) => key !== "database" && Number(value) !== 0)) process.exitCode = 1;
