import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import ExcelJS from "exceljs";
import nextEnv from "@next/env";
import { databaseUrlFor, requireDisposableDatabaseName } from "./lib/disposable-database.js";
import { getCycleReportWithClient } from "../src/modules/reports/cycle-report.service.js";
import { buildCycleReportExcel } from "../src/modules/reports/cycle-report-excel.js";
import { getMeetingReportWithClient } from "../src/modules/reports/meeting-report.service.js";
import { buildMeetingReportExcel } from "../src/modules/reports/meeting-report-excel.js";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const database = requireDisposableDatabaseName(process.env.REPORTS_ACCEPTANCE_DB || "cccrn_vsla_acceptance");
const connectionString = databaseUrlFor(new URL(process.env.DATABASE_URL), database).toString();
const db = new pg.Client({ connectionString });
const token = crypto.randomUUID().slice(0, 8);
let transactionOpen = false;
let sequence = 0;
const next = (prefix) => `${prefix}-${token}-${++sequence}`;

await db.connect();
try {
  await db.query("BEGIN");
  transactionOpen = true;
  const organization = (await db.query("INSERT INTO organizations(code,name,status) VALUES($1,$2,'ACTIVE') RETURNING id", [next("RPT").toUpperCase(), `Reporting ${token}`])).rows[0];
  const reporter = (await db.query("INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status) VALUES($1,'Report','Admin',$2,'unused','ACTIVE') RETURNING id,organization_id,first_name,last_name,email", [organization.id, `${next("report")}@test.local`])).rows[0];
  const project = (await db.query("INSERT INTO projects(organization_id,code,name,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4) RETURNING id", [organization.id, next("P").toUpperCase(), `Reporting project ${token}`, reporter.id])).rows[0];
  const location = (await db.query("SELECT s.id state_id,l.id lga_id FROM states s JOIN lgas l ON l.state_id=s.id ORDER BY s.name,l.name LIMIT 1")).rows[0];
  if (!location) throw new Error("Acceptance database requires migrated geography");
  const group = (await db.query(`INSERT INTO vsla_groups(organization_id,project_id,group_code,name,state_id,lga_id,community_name,date_formed,meeting_location,group_type,status,operation_mode,created_by) VALUES($1,$2,$3,$4,$5,$6,'Acceptance Community','2025-01-01','Hall','SELF_MANAGED','ACTIVE','PROGRAM_ASSISTED',$7) RETURNING id,group_code`, [organization.id, project.id, next("CCCRN-NIG-MNA").toUpperCase(), `Reporting Group ${token}`, location.state_id, location.lga_id, reporter.id])).rows[0];
  const constitution = (await db.query(`INSERT INTO group_constitutions(organization_id,group_id,version_number,status,share_value,min_shares_per_meeting,max_shares_per_meeting,social_fund_contribution,loan_max_multiple,loan_service_charge_rate,loan_max_term_months,meeting_frequency,approved_at,approved_by,created_by) VALUES($1,$2,1,'APPROVED',2000,1,5,500,3,10,3,'WEEKLY',now(),$3,$3) RETURNING id`, [organization.id, group.id, reporter.id])).rows[0];
  const cycle1 = (await db.query(`INSERT INTO vsla_cycles(organization_id,group_id,constitution_id,cycle_number,start_date,expected_end_date,expected_shareout_date,status,activated_at,closed_at,closed_by,created_by) VALUES($1,$2,$3,1,'2025-01-01','2025-06-30','2025-06-30','CLOSED','2025-01-01','2025-06-30',$4,$4) RETURNING id,cycle_number`, [organization.id, group.id, constitution.id, reporter.id])).rows[0];
  const cycle2 = (await db.query(`INSERT INTO vsla_cycles(organization_id,group_id,constitution_id,cycle_number,start_date,expected_end_date,expected_shareout_date,status,activated_at,created_by) VALUES($1,$2,$3,2,'2025-07-01','2025-12-31','2025-12-31','ACTIVE','2025-07-01',$4) RETURNING id,cycle_number`, [organization.id, group.id, constitution.id, reporter.id])).rows[0];

  const members = {};
  for (const [index, name] of ["Amina", "Musa", "Grace", "John", "Samuel"].entries()) {
    members[name] = (await db.query(`INSERT INTO group_members(organization_id,group_id,member_number,member_code,first_name,last_name,date_joined,status,created_by) VALUES($1,$2,$3,$4,$5,'Member',$6,'ACTIVE',$7) RETURNING id,member_code`, [organization.id, group.id, index + 1, `${group.group_code}-${String(index + 1).padStart(3, "0")}`, name, name === "Samuel" ? "2025-07-15" : "2025-01-01", reporter.id])).rows[0];
  }
  for (const name of ["Amina", "Musa", "Grace"]) await db.query("INSERT INTO cycle_memberships(organization_id,group_id,cycle_id,member_id,participation_start_date,created_by) VALUES($1,$2,$3,$4,'2025-01-01',$5)", [organization.id, group.id, cycle1.id, members[name].id, reporter.id]);
  for (const name of ["Amina", "Musa", "John"]) await db.query("INSERT INTO cycle_memberships(organization_id,group_id,cycle_id,member_id,participation_start_date,created_by) VALUES($1,$2,$3,$4,'2025-07-01',$5)", [organization.id, group.id, cycle2.id, members[name].id, reporter.id]);
  await db.query("INSERT INTO cycle_memberships(organization_id,group_id,cycle_id,member_id,participation_start_date,created_by) VALUES($1,$2,$3,$4,'2025-07-15',$5)", [organization.id, group.id, cycle2.id, members.Samuel.id, reporter.id]);

  const accounts = new Map();
  for (const cycle of [cycle1, cycle2]) {
    await db.query(`INSERT INTO ledger_accounts(organization_id,group_id,cycle_id,account_code,account_name,account_category,normal_side,fund_type) SELECT $1,$2,$3,v.code,v.name,v.category,v.side,v.fund FROM(VALUES ('SAVINGS_LOAN_CASH','Savings/Loan Cash','ASSET','DEBIT','SAVINGS_LOAN'),('SOCIAL_FUND_CASH','Social Fund Cash','ASSET','DEBIT','SOCIAL_FUND'),('MEMBER_SAVINGS_CONTROL','Member Savings Control','EQUITY','CREDIT','SAVINGS_LOAN'),('SOCIAL_FUND_CONTROL','Social Fund Control','EQUITY','CREDIT','SOCIAL_FUND'),('FINE_INCOME','Fine Income','INCOME','CREDIT','SAVINGS_LOAN'),('LOANS_RECEIVABLE','Loans Receivable','ASSET','DEBIT','SAVINGS_LOAN'),('LOAN_SERVICE_CHARGE_INCOME','Loan Service Charge Income','INCOME','CREDIT','SAVINGS_LOAN'),('SHAREOUT_PAYABLE','Share-Out Payable','LIABILITY','CREDIT','SAVINGS_LOAN'))v(code,name,category,side,fund) ON CONFLICT(cycle_id,account_code) DO NOTHING`, [organization.id, group.id, cycle.id]);
    const result = await db.query("SELECT id,account_code FROM ledger_accounts WHERE cycle_id=$1", [cycle.id]);
    accounts.set(cycle.id, Object.fromEntries(result.rows.map((row) => [row.account_code, row.id])));
  }

  async function meeting(cycleId, number, date, status = "CLOSED") {
    const row = (await db.query(`INSERT INTO vsla_meetings(organization_id,group_id,cycle_id,meeting_number,meeting_code,meeting_date,status,opened_by,closed_by,closed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,meeting_number,meeting_date::text`, [organization.id, group.id, cycleId, number, next("MEETING"), date, status, reporter.id, status === "CLOSED" ? reporter.id : null, status === "CLOSED" ? `${date}T12:00:00Z` : null])).rows[0];
    return row;
  }
  const c1m1 = await meeting(cycle1.id, 1, "2025-01-07");
  const c2m1 = await meeting(cycle2.id, 1, "2025-07-01");
  const c2m2 = await meeting(cycle2.id, 2, "2025-07-08");
  const c2m3 = await meeting(cycle2.id, 3, "2025-07-15", "OPEN");
  for (const name of ["Amina", "Musa", "Grace"]) await db.query("INSERT INTO meeting_attendance(organization_id,meeting_id,group_id,cycle_id,member_id,attendance_status,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())", [organization.id, c1m1.id, group.id, cycle1.id, members[name].id, name === "Musa" ? "LATE" : "PRESENT", reporter.id]);
  for (const meetingRow of [c2m1, c2m2]) for (const name of ["Amina", "Musa", "John"]) await db.query("INSERT INTO meeting_attendance(organization_id,meeting_id,group_id,cycle_id,member_id,attendance_status,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,'PRESENT',$6,now())", [organization.id, meetingRow.id, group.id, cycle2.id, members[name].id, reporter.id]);
  for (const name of ["Amina", "Musa", "John", "Samuel"]) await db.query("INSERT INTO meeting_attendance(organization_id,meeting_id,group_id,cycle_id,member_id,attendance_status,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,'PRESENT',$6,now())", [organization.id, c2m3.id, group.id, cycle2.id, members[name].id, reporter.id]);

  async function financial(cycleId, meetingId, memberId, type, date, lines, reversalOf = null) {
    const tx = (await db.query(`INSERT INTO financial_transactions(organization_id,group_id,cycle_id,meeting_id,member_id,transaction_type,reference_code,effective_date,reversal_of_transaction_id,idempotency_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [organization.id, group.id, cycleId, meetingId, memberId, type, next("TX"), date, reversalOf, next("IDEMP"), crypto.randomBytes(32).toString("hex"), reporter.id])).rows[0];
    for (const [account, side, amount] of lines) await db.query("INSERT INTO ledger_entries(financial_transaction_id,ledger_account_id,entry_side,amount) VALUES($1,$2,$3,$4)", [tx.id, accounts.get(cycleId)[account], side, amount]);
    return tx;
  }
  async function saving(cycleId, meetingRow, member, kind, shares, amount, original = null) {
    const tx = await financial(cycleId, meetingRow.id, member.id, kind === "PURCHASE" ? "SAVINGS_PURCHASE" : "SAVINGS_REVERSAL", meetingRow.meeting_date, kind === "PURCHASE" ? [["SAVINGS_LOAN_CASH", "DEBIT", amount], ["MEMBER_SAVINGS_CONTROL", "CREDIT", amount]] : [["MEMBER_SAVINGS_CONTROL", "DEBIT", amount], ["SAVINGS_LOAN_CASH", "CREDIT", amount]], original?.tx.id || null);
    const row = (await db.query(`INSERT INTO savings_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,transaction_kind,shares,share_value,amount,original_savings_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2000,$9,$10,$11) RETURNING id`, [tx.id, organization.id, group.id, cycleId, meetingRow.id, member.id, kind, shares, amount, original?.row.id || null, reporter.id])).rows[0];
    return { tx, row };
  }
  async function social(cycleId, meetingRow, member, kind, amount, original = null) {
    const tx = await financial(cycleId, meetingRow.id, member.id, kind === "CONTRIBUTION" ? "SOCIAL_FUND_CONTRIBUTION" : "SOCIAL_FUND_REVERSAL", meetingRow.meeting_date, kind === "CONTRIBUTION" ? [["SOCIAL_FUND_CASH", "DEBIT", amount], ["SOCIAL_FUND_CONTROL", "CREDIT", amount]] : [["SOCIAL_FUND_CONTROL", "DEBIT", amount], ["SOCIAL_FUND_CASH", "CREDIT", amount]], original?.tx.id || null);
    const row = (await db.query(`INSERT INTO social_fund_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,transaction_kind,amount,original_social_fund_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [tx.id, organization.id, group.id, cycleId, meetingRow.id, member.id, kind, amount, original?.row.id || null, reporter.id])).rows[0];
    return { tx, row };
  }

  const originalSaving = await saving(cycle1.id, c1m1, members.Amina, "PURCHASE", 5, "10000.00");
  await saving(cycle1.id, c1m1, members.Amina, "REVERSAL", 5, "10000.00", originalSaving);
  await saving(cycle1.id, c1m1, members.Amina, "PURCHASE", 4, "8000.00");
  const originalSocial = await social(cycle1.id, c1m1, members.Amina, "CONTRIBUTION", "1000.00");
  await social(cycle1.id, c1m1, members.Amina, "REVERSAL", "1000.00", originalSocial);
  await social(cycle1.id, c1m1, members.Amina, "CONTRIBUTION", "500.00");
  const fineTx = await financial(cycle1.id, c1m1.id, members.Musa.id, "FINE", c1m1.meeting_date, [["SAVINGS_LOAN_CASH", "DEBIT", "100.00"], ["FINE_INCOME", "CREDIT", "100.00"]]);
  const fineRule = (await db.query("INSERT INTO constitution_fine_rules(constitution_id,code,name,amount,status) VALUES($1,$2,'Late arrival',100,'ACTIVE') RETURNING id", [constitution.id, next("LATE")])).rows[0];
  await db.query("INSERT INTO fine_transactions(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,member_id,fine_rule_id,transaction_kind,amount,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'FINE',100,'Late',$8)", [fineTx.id, organization.id, group.id, cycle1.id, c1m1.id, members.Musa.id, fineRule.id, reporter.id]);

  const request = (await db.query(`INSERT INTO loan_requests(organization_id,group_id,cycle_id,member_id,request_meeting_id,request_code,requested_principal,requested_term_months,purpose,savings_snapshot,maximum_eligible_snapshot,status,requested_by) VALUES($1,$2,$3,$4,$5,$6,5000,2,'Trade',8000,24000,'DISBURSED',$7) RETURNING id`, [organization.id, group.id, cycle1.id, members.Musa.id, c1m1.id, next("REQ"), reporter.id])).rows[0];
  const decision = (await db.query(`INSERT INTO loan_decisions(loan_request_id,organization_id,group_id,cycle_id,member_id,decision_meeting_id,decision,approved_principal,approved_term_months,savings_snapshot,maximum_eligible_snapshot,decided_by) VALUES($1,$2,$3,$4,$5,$6,'APPROVED',5000,2,8000,24000,$7) RETURNING id`, [request.id, organization.id, group.id, cycle1.id, members.Musa.id, c1m1.id, reporter.id])).rows[0];
  const disbursement = await financial(cycle1.id, c1m1.id, members.Musa.id, "LOAN_DISBURSEMENT", c1m1.meeting_date, [["LOANS_RECEIVABLE", "DEBIT", "5000.00"], ["SAVINGS_LOAN_CASH", "CREDIT", "5000.00"]]);
  const loan = (await db.query(`INSERT INTO loans(organization_id,group_id,cycle_id,member_id,loan_request_id,loan_decision_id,constitution_id,loan_code,disbursement_meeting_id,disbursement_financial_transaction_id,principal_disbursed,service_charge_rate,term_months,service_charge_total_due,total_contractual_due,disbursement_date,due_date,settled_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,5000,10,2,500,5500,'2025-02-01','2025-04-01','2025-03-01',$11) RETURNING id`, [organization.id, group.id, cycle1.id, members.Musa.id, request.id, decision.id, constitution.id, next("LOAN"), c1m1.id, disbursement.id, reporter.id])).rows[0];
  const repayment = await financial(cycle1.id, c1m1.id, members.Musa.id, "LOAN_REPAYMENT", "2025-03-01", [["SAVINGS_LOAN_CASH", "DEBIT", "5500.00"], ["LOANS_RECEIVABLE", "CREDIT", "5000.00"], ["LOAN_SERVICE_CHARGE_INCOME", "CREDIT", "500.00"]]);
  await db.query(`INSERT INTO loan_repayments(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,loan_id,member_id,transaction_kind,payment_amount,principal_component,service_charge_component,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'PAYMENT',5500,5000,500,$8)`, [repayment.id, organization.id, group.id, cycle1.id, c1m1.id, loan.id, members.Musa.id, reporter.id]);

  const reclassification = await financial(cycle1.id, c1m1.id, null, "SHAREOUT_RECLASSIFICATION", "2025-06-30", [["MEMBER_SAVINGS_CONTROL", "DEBIT", "8000.00"], ["FINE_INCOME", "DEBIT", "100.00"], ["LOAN_SERVICE_CHARGE_INCOME", "DEBIT", "500.00"], ["SHAREOUT_PAYABLE", "CREDIT", "8600.00"]]);
  const shareout = (await db.query(`INSERT INTO cycle_shareouts(organization_id,group_id,cycle_id,final_meeting_id,version_number,status,total_net_shares,total_net_savings,fine_income,service_charge_income,distributable_fund,raw_value_per_share,social_fund_balance_snapshot,financial_state_fingerprint,algorithm_version,reclassification_financial_transaction_id,prepared_by,prepared_at,approved_by,approved_at,completed_by,completed_at) VALUES($1,$2,$3,$4,1,'COMPLETED',4,8000,100,500,8600,2150,500,$5,'LARGEST_REMAINDER_V1',$6,$7,'2025-06-30',$7,'2025-06-30',$7,'2025-06-30') RETURNING id`, [organization.id, group.id, cycle1.id, c1m1.id, crypto.randomBytes(32).toString("hex"), reclassification.id, reporter.id])).rows[0];
  const entitlement = (await db.query(`INSERT INTO cycle_shareout_entitlements(organization_id,group_id,cycle_id,shareout_id,member_id,member_code_snapshot,member_name_snapshot,net_shares,net_savings,raw_entitlement,base_rounded_entitlement,rounding_adjustment,final_entitlement,surplus_amount) VALUES($1,$2,$3,$4,$5,$6,'Amina Member',4,8000,8600,8600,0,8600,600) RETURNING id`, [organization.id, group.id, cycle1.id, shareout.id, members.Amina.id, members.Amina.member_code])).rows[0];
  const payout = await financial(cycle1.id, c1m1.id, members.Amina.id, "SHAREOUT_PAYOUT", "2025-06-30", [["SHAREOUT_PAYABLE", "DEBIT", "8600.00"], ["SAVINGS_LOAN_CASH", "CREDIT", "8600.00"]]);
  await db.query(`INSERT INTO shareout_payouts(financial_transaction_id,organization_id,group_id,cycle_id,meeting_id,shareout_id,entitlement_id,member_id,transaction_kind,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PAYOUT',8600,$9)`, [payout.id, organization.id, group.id, cycle1.id, c1m1.id, shareout.id, entitlement.id, members.Amina.id, reporter.id]);
  const carryOut = await financial(cycle1.id, null, null, "SOCIAL_FUND_CARRY_FORWARD_OUT", "2025-06-30", [["SOCIAL_FUND_CONTROL", "DEBIT", "500.00"], ["SOCIAL_FUND_CASH", "CREDIT", "500.00"]]);
  const carryIn = await financial(cycle2.id, null, null, "SOCIAL_FUND_CARRY_FORWARD_IN", "2025-07-01", [["SOCIAL_FUND_CASH", "DEBIT", "500.00"], ["SOCIAL_FUND_CONTROL", "CREDIT", "500.00"]]);
  await db.query(`INSERT INTO cycle_social_fund_transfers(organization_id,group_id,source_cycle_id,target_cycle_id,amount,source_financial_transaction_id,target_financial_transaction_id,idempotency_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,500,$5,$6,$7,$8,$9)`, [organization.id, group.id, cycle1.id, cycle2.id, carryOut.id, carryIn.id, next("CARRY"), crypto.randomBytes(32).toString("hex"), reporter.id]);
  const reconciliation = (await db.query(`INSERT INTO meeting_reconciliations(organization_id,group_id,cycle_id,meeting_id,expected_savings_loan_balance,counted_savings_loan_balance,expected_social_fund_balance,counted_social_fund_balance,notes,created_by) VALUES($1,$2,$3,$4,0,0,0,0,'Final',$5) RETURNING id`, [organization.id, group.id, cycle1.id, c1m1.id, reporter.id])).rows[0];
  await db.query(`INSERT INTO reconciliation_signatures(organization_id,group_id,meeting_id,reconciliation_id,signed_by_user_id,storage_key,mime_type,file_size_bytes,sha256) VALUES($1,$2,$3,$4,$5,$6,'image/png',1,$7)`, [organization.id, group.id, c1m1.id, reconciliation.id, reporter.id, next("sign"), crypto.randomBytes(32).toString("hex")]);

  await saving(cycle2.id, c2m1, members.Amina, "PURCHASE", 2, "4000.00");
  await social(cycle2.id, c2m1, members.Amina, "CONTRIBUTION", "500.00");
  await saving(cycle2.id, c2m3, members.Samuel, "PURCHASE", 1, "2000.00");
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");

  const actor = { ...reporter, roles: ["SUPER_ADMIN"], permissions: ["report.view", "report.export"] };
  const report1 = await getCycleReportWithClient(actor, group.id, cycle1.id, db);
  const report2 = await getCycleReportWithClient(actor, group.id, cycle2.id, db);
  const meetingReport1 = await getMeetingReportWithClient(actor, group.id, cycle1.id, c1m1.id, db);
  const meetingReportCycle2 = await getMeetingReportWithClient(actor, group.id, cycle2.id, c2m1.id, db);
  const meetingReport2 = await getMeetingReportWithClient(actor, group.id, cycle2.id, c2m2.id, db);
  const meetingReport3 = await getMeetingReportWithClient(actor, group.id, cycle2.id, c2m3.id, db);
  assert.deepEqual(report1.attendance.rows.map((row) => row.member_name), ["Amina Member", "Musa Member", "Grace Member"]);
  assert.deepEqual(report2.attendance.rows.map((row) => row.member_name), ["Amina Member", "Musa Member", "John Member", "Samuel Member"]);
  assert.ok(!report1.attendance.rows.some((row) => row.member_name === "John Member"));
  assert.equal(report1.cycleSummary.netSavings, "8000.00");
  assert.equal(report1.cycleSummary.socialFundMemberContributions, "500.00");
  assert.equal(report1.loans.totals.disbursed, "5000.00");
  assert.equal(report1.loans.totals.repaid, "5500.00");
  assert.equal(report1.shareout.summary.totalEntitlements, "8600.00");
  assert.equal(report1.closure.signatureRecorded, true);
  assert.equal(report1.reconciliation.status, "PASSED");
  assert.equal(report2.socialFund.summary.openingCarryIn, "500.00");
  assert.equal(report2.socialFund.summary.memberContributions, "500.00");
  assert.equal(report2.socialFund.summary.currentClosingBalance, "1000.00");
  const samuelAttendance = report2.attendance.rows.find((row) => row.member_name === "Samuel Member");
  assert.deepEqual([samuelAttendance.byMeeting[c2m1.id], samuelAttendance.byMeeting[c2m2.id], samuelAttendance.byMeeting[c2m3.id]], ["—", "—", "P"]);
  const historicalWorkbook = new ExcelJS.Workbook();
  await historicalWorkbook.xlsx.load(await buildCycleReportExcel(report1));
  const currentWorkbook = new ExcelJS.Workbook();
  await currentWorkbook.xlsx.load(await buildCycleReportExcel(report2));
  const workbookMembers = (workbook) => workbook.getWorksheet("Attendance Register").getRows(6, workbook.getWorksheet("Attendance Register").rowCount - 5).map((row) => row.getCell(2).value);
  assert.deepEqual(workbookMembers(historicalWorkbook), ["Amina Member", "Musa Member", "Grace Member"]);
  assert.deepEqual(workbookMembers(currentWorkbook), ["Amina Member", "Musa Member", "John Member", "Samuel Member"]);
  assert.deepEqual(meetingReport1.attendance.rows.map((row) => row.memberName), ["Amina Member", "Musa Member", "Grace Member"]);
  assert.ok(!meetingReport2.attendance.rows.some((row) => row.memberName === "Samuel Member"));
  assert.ok(meetingReport3.attendance.rows.some((row) => row.memberName === "Samuel Member"));
  assert.equal(meetingReport1.meetingSummary.netSavings, "8000.00");
  assert.equal(meetingReport1.meetingSummary.socialFundContributions, "500.00");
  assert.equal(meetingReport1.meetingSummary.loanPrincipalDisbursed, "5000.00");
  assert.equal(meetingReport1.meetingSummary.loanRepayments, "5500.00");
  assert.equal(meetingReport1.reconciliation.status, "BALANCED");
  assert.equal(meetingReport1.reconciliation.signatureRecorded, true);
  assert.equal(meetingReportCycle2.socialFund.total, "500.00");
  assert.ok((await buildMeetingReportExcel(meetingReport1)).byteLength > 1000);
  console.log(JSON.stringify({ database, rolledBack: true, historicalParticipants: report1.attendance.rows.map((row) => row.member_name), currentParticipants: report2.attendance.rows.map((row) => row.member_name), workbookParticipantParity: true, historicalSavings: report1.cycleSummary.netSavings, historicalSocialFundContributions: report1.cycleSummary.socialFundMemberContributions, loanDisbursed: report1.loans.totals.disbursed, loanRepaid: report1.loans.totals.repaid, shareoutEntitlements: report1.shareout.summary.totalEntitlements, cycle2CarryIn: report2.socialFund.summary.openingCarryIn, cycle2Contributions: report2.socialFund.summary.memberContributions, cycle2Balance: report2.socialFund.summary.currentClosingBalance, samuelAttendance: [samuelAttendance.byMeeting[c2m1.id], samuelAttendance.byMeeting[c2m2.id], samuelAttendance.byMeeting[c2m3.id]], reconciliation: report1.reconciliation.status, meetingReport: { participants: meetingReport1.attendance.rows.map((row) => row.memberName), savings: meetingReport1.meetingSummary.netSavings, socialFund: meetingReport1.meetingSummary.socialFundContributions, cycle2ContributionExcludingCarry: meetingReportCycle2.socialFund.total, loanDisbursed: meetingReport1.meetingSummary.loanPrincipalDisbursed, loanRepaid: meetingReport1.meetingSummary.loanRepayments, reconciliation: meetingReport1.reconciliation.status, signatureRecorded: meetingReport1.reconciliation.signatureRecorded, midCycleJoinIsolated: true, excelGenerated: true } }, null, 2));
} finally {
  if (transactionOpen) await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
