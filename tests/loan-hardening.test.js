import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loanRequestSchema, approveLoanSchema } from "../src/modules/loans/loan.schemas.js";
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const service = fs.readFileSync("src/modules/loans/loan.service.js", "utf8");
const migration = fs.readFileSync("database/migrations/037_loan_lifecycle_hardening.sql", "utf8");
test("new loan requests require a meaningful purpose", () => {
  const base = { memberId: uuid, requestedPrincipal: "10000", requestedTermMonths: 2 };
  assert.equal(loanRequestSchema.safeParse({ ...base, purpose: "Purchase farming inputs" }).success, true);
  assert.equal(loanRequestSchema.safeParse(base).success, false);
  assert.equal(loanRequestSchema.safeParse({ ...base, purpose: "  " }).success, false);
});
test("approval supports a positive negotiated amount and term", () => assert.equal(approveLoanSchema.safeParse({ approvedPrincipal: "7500", approvedTermMonths: 3, notes: null }).success, true));
test("migration protects unresolved requests and cross-entity contexts", () => {
  assert.match(migration, /one_unresolved_loan_request_per_member_cycle/);
  assert.match(migration, /Loan hardening diagnostics found historical integrity violations/);
  for (const constraint of ["loan_decisions_request_context_fk", "loans_request_context_fk", "loans_decision_context_fk", "loan_repayments_loan_context_fk"]) assert.match(migration, new RegExp(constraint));
});
test("service enforces attendance, cycles, duties, complete terms, and newest-first reversal", () => {
  for (const token of ["BORROWER_NOT_PRESENT", "LOAN_CONTEXT_MISMATCH", "LOAN_SEPARATION_OF_DUTIES_VIOLATION", "LOAN_TERMS_INCOMPLETE", "LOAN_REPAYMENT_REVERSAL_ORDER_INVALID", "LOAN_REQUEST_ALREADY_OPEN"]) assert.match(service, new RegExp(token));
  assert.match(service, /attendance_status !== "PRESENT"/);
  assert.match(service, /later\.created_at,later\.id/);
});
test("accounting formulas and charge-first repayment remain unchanged", () => {
  assert.match(service, /LOAN_SERVICE_CHARGE_INCOME/);
  assert.match(service, /LOANS_RECEIVABLE/);
  assert.match(service, /LEAST\(\$1::numeric,\$2::numeric\)/);
  assert.match(service, /\$1::numeric\*\(\$2::numeric\/100\)\*\$3::int/);
});
