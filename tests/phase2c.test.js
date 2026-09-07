import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loanRequestSchema, approveLoanSchema, repaymentSchema } from "../src/modules/loans/loan.schemas.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request = (requestedPrincipal = "30000.00") => ({ memberId: id, requestedPrincipal, requestedTermMonths: 3, purpose: "Purchase farming inputs" });
test("loan money inputs accept decimals and reject formatted or nonpositive values", () => {
  assert.equal(loanRequestSchema.safeParse(request()).success, true);
  for (const value of ["0", "-1", "30,000", "₦30000"]) assert.equal(loanRequestSchema.safeParse(request(value)).success, false);
});
test("loan terms and repayment amounts require positive values", () => {
  assert.equal(approveLoanSchema.safeParse({ approvedPrincipal: "25000", approvedTermMonths: 3 }).success, true);
  assert.equal(repaymentSchema.safeParse({ paymentAmount: "0", idempotencyKey: "abcdefgh" }).success, false);
});
test("Phase 2C migration preserves numeric constraints and outstanding-loan uniqueness", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/020_phase_2c_loans.sql", import.meta.url), "utf8");
  for (const fragment of ["one_outstanding_loan_per_member_cycle", "payment_amount=principal_component+service_charge_component", "LOANS_RECEIVABLE", "LOAN_SERVICE_CHARGE_INCOME", "LOAN_DISBURSEMENT_REVERSAL"]) assert.ok(sql.includes(fragment));
});
