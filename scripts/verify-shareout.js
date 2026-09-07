import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) { const match = line.match(/^([^#][^=]*)=(.*)$/); if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, ""); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
try {
  const proof = (await db.query(`SELECT
    (SELECT COUNT(*)::int FROM cycle_shareouts) shareouts,
    (SELECT COUNT(*)::int FROM cycle_shareout_entitlements) entitlements,
    (SELECT COUNT(*)::int FROM shareout_payouts) payouts,
    (SELECT COUNT(*)::int FROM cycle_social_fund_transfers) social_fund_transfers,
    (SELECT COUNT(*)::int FROM (SELECT shareout_id FROM cycle_shareout_entitlements GROUP BY shareout_id HAVING SUM(final_entitlement)<>(SELECT distributable_fund FROM cycle_shareouts WHERE id=shareout_id)) x) entitlement_total_discrepancies,
    (SELECT COUNT(*)::int FROM (SELECT s.id FROM cycle_shareouts s JOIN cycle_shareout_entitlements e ON e.shareout_id=s.id LEFT JOIN (SELECT entitlement_id,SUM(CASE transaction_kind WHEN 'PAYOUT' THEN amount ELSE -amount END) paid FROM shareout_payouts GROUP BY entitlement_id)p ON p.entitlement_id=e.id WHERE s.status='COMPLETED' GROUP BY s.id HAVING SUM(e.final_entitlement)<>SUM(COALESCE(p.paid,0)))x) completed_payout_discrepancies,
    (SELECT COUNT(*)::int FROM cycle_social_fund_transfers x JOIN financial_transactions o ON o.id=x.source_financial_transaction_id JOIN financial_transactions i ON i.id=x.target_financial_transaction_id WHERE o.transaction_type<>'SOCIAL_FUND_CARRY_FORWARD_OUT' OR i.transaction_type<>'SOCIAL_FUND_CARRY_FORWARD_IN') transfer_type_discrepancies`)).rows[0];
  if (proof.entitlement_total_discrepancies || proof.completed_payout_discrepancies || proof.transfer_type_discrepancies) throw new Error(`Share-out integrity failure: ${JSON.stringify(proof)}`);
  console.log(JSON.stringify(proof, null, 2));
} finally { await db.end(); }
