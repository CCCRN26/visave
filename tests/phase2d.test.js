import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { approveShareoutSchema, carryForwardSchema, payoutSchema } from "../src/modules/shareout/shareout.schemas.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("Phase 2D write schemas require UUID resources and idempotency keys", () => {
  assert.equal(approveShareoutSchema.safeParse({ idempotencyKey: "phase2d-key" }).success, true);
  assert.equal(payoutSchema.safeParse({ entitlementId: id, idempotencyKey: "phase2d-key" }).success, true);
  assert.equal(carryForwardSchema.safeParse({ targetCycleId: id, idempotencyKey: "short" }).success, false);
});

test("Phase 2D migration defines immutable share-out records and payout concurrency guard", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/023_phase_2d_shareout.sql", import.meta.url), "utf8");
  for (const requirement of [
    "cycle_shareouts",
    "cycle_shareout_entitlements",
    "shareout_payouts",
    "cycle_social_fund_transfers",
    "SHAREOUT_PAYABLE",
    "pg_advisory_xact_lock",
    "immutable_shareout_payouts",
    "immutable_social_fund_transfers",
  ]) assert.ok(sql.includes(requirement), requirement);
});

test("Phase 2D financial types preserve meetingless carry-forward without allowing other meetingless posts", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/023_phase_2d_shareout.sql", import.meta.url), "utf8");
  assert.match(sql, /SOCIAL_FUND_CARRY_FORWARD_OUT/);
  assert.match(sql, /meeting_id IS NULL AND transaction_type IN/);
  assert.match(sql, /meeting_id IS NOT NULL AND transaction_type NOT IN/);
});

test("Phase 2D hardening rejects completed reversals and enforces closed-before-active sequencing", () => {
  const service=fs.readFileSync(new URL("../src/modules/shareout/shareout.service.js",import.meta.url),"utf8");
  assert.match(service,/SHAREOUT_COMPLETED_PAYOUT_REVERSAL_NOT_ALLOWED/);
  assert.match(service,/PREVIOUS_CYCLE_NOT_CLOSED/);
  assert.match(service,/FINAL_MEETING_NOT_LATEST/);
  assert.match(service,/SAVINGS_SHARE_VALUE_DISCREPANCY/);
});

test("Migration 038 diagnoses history before adding composite share-out relationships",()=>{
  const sql=fs.readFileSync(new URL("../database/migrations/038_shareout_cycle_hardening.sql",import.meta.url),"utf8");
  for(const requirement of ["completed_unpaid","invalid_allocations","shareout_payouts_entitlement_context_fk","cycle_shareouts_final_meeting_cycle_fk","social_transfer_source_context_fk"])
    assert.ok(sql.includes(requirement),requirement);
});
