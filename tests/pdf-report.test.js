import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createPdf, finishPdf, keyValues, section, table } from "../src/modules/reports/report-pdf.js";

const report = { metadata: { groupName: "O'Connor Savings Group", groupCode: "NG-01", cycleNumber: 2, generatedAt: "2026-09-06T10:00:00Z", generatedBy: { name: "Amina Bello" } } };
test("shared PDF utility generates a branded paginated A4 PDF with long and empty tables", async () => {
  const { doc, done } = createPdf(report, "Cycle Report"); section(doc, "Overview"); keyValues(doc, [["Net savings", "8000.00", true]]); table(doc, ["Member", "Amount"], Array.from({ length: 35 }, (_, i) => [`Member ${i} O'Connor`, "NGN 500.00"]), [300, 211]); section(doc, "Empty section"); table(doc, ["Activity"], [], [511]); finishPdf(doc); const pdf = await done; assert.ok(pdf.length > 1000); assert.equal(pdf.subarray(0, 4).toString(), "%PDF"); });
test("PDF routes reuse canonical report services and protected export access", () => { const files = ["src/app/api/v1/groups/[id]/cycles/[cycleId]/reports/pdf/route.js", "src/app/api/v1/groups/[id]/cycles/[cycleId]/meetings/[meetingId]/reports/pdf/route.js", "src/app/api/v1/groups/[id]/cycles/[cycleId]/members/[memberId]/reports/pdf/route.js"]; files.forEach(file => { const source = fs.readFileSync(file, "utf8"); assert.match(source, /requireAuth/); assert.match(source, /"application\/pdf"/); assert.match(source, /"export"/); }); });
test("PDF renderers expose the approved canonical detail sections", () => {
  const cycle = fs.readFileSync("src/modules/reports/cycle-report-pdf.js", "utf8");
  const meeting = fs.readFileSync("src/modules/reports/meeting-report-pdf.js", "utf8");
  const member = fs.readFileSync("src/modules/reports/member-statement-pdf.js", "utf8");
  ["Cycle Overview", "Financial Summary", "Meeting Summary", "Attendance Summary", "Savings Summary", "Social Fund Summary", "Fines Detail", "Loans Detail", "Share-out Detail", "Cycle Closure / Reconciliation", "Social Fund is not included in Share-out"].forEach(value => assert.match(cycle, new RegExp(value)));
  ["Loan Requests", "Loan Disbursements", "Loan Repayments", "requestedAmount", "principalComponent", "serviceChargeComponent"].forEach(value => assert.match(meeting, new RegExp(value)));
  ["Loan Transactions", "transactionType", "principalComponent", "serviceChargeComponent", "Share-out"].forEach(value => assert.match(member, new RegExp(value)));
});
