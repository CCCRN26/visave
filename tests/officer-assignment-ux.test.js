import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getOfficerAssignmentOptions, isOfficerCycleEditable, normalizeOfficerCycleDates } from "../src/modules/onboarding/officer-assignment-options.js";
import { OFFICER_POSITIONS } from "../src/modules/onboarding/constants.js";

const component = fs.readFileSync("src/components/officer-assignment-panel.js", "utf8");
const overview = fs.readFileSync("src/app/(protected)/groups/[id]/page.js", "utf8");
const service = fs.readFileSync("src/modules/onboarding/onboarding.service.js", "utf8");
const removeRoute = fs.readFileSync("src/app/api/v1/groups/[id]/officers/[assignmentId]/route.js", "utf8");
const onboarding = fs.readFileSync("src/components/onboarding-wizard.js", "utf8");
const onboardingPage = fs.readFileSync("src/app/(protected)/groups/[id]/onboarding/page.js", "utf8");
const officersPage = fs.readFileSync("src/app/(protected)/groups/[id]/officers/page.js", "utf8");
const cyclesRoute = fs.readFileSync("src/app/api/v1/groups/[id]/cycles/route.js", "utf8");

const participants = [
  { member_id: "member-1", member_status: "ACTIVE" },
  { member_id: "member-2", member_status: "ACTIVE" },
  { member_id: "member-3", member_status: "ACTIVE" },
  { member_id: "member-4", member_status: "INACTIVE" },
];
const assignments = [
  { id: "assignment-1", member_id: "member-1", position_code: "CHAIRPERSON", status: "ACTIVE" },
  { id: "assignment-2", member_id: "member-2", position_code: "RECORD_KEEPER", status: "ACTIVE" },
];

test("assigned members and occupied positions are excluded while valid choices remain", () => {
  const options = getOfficerAssignmentOptions(participants, assignments);
  assert.deepEqual(options.eligibleParticipants.map((member) => member.member_id), ["member-3"]);
  assert.deepEqual(options.availablePositions, ["BOX_KEEPER", "MONEY_COUNTER_1", "MONEY_COUNTER_2"]);
});

test("assignment refresh removes the new member and position from subsequent choices", () => {
  const added = { id: "assignment-3", member_id: "member-3", position_code: "BOX_KEEPER", status: "ACTIVE" };
  const options = getOfficerAssignmentOptions(participants, [...assignments, added]);
  assert.deepEqual(options.eligibleParticipants, []);
  assert.deepEqual(options.availablePositions, ["MONEY_COUNTER_1", "MONEY_COUNTER_2"]);
  assert.match(component, /router\.refresh\(\)/);
});

test("undo uses the authorized history-preserving officer removal path", () => {
  assert.match(component, /method: "DELETE"/);
  assert.match(component, /Undo this officer assignment\?/);
  assert.match(component, /The assignment history will be kept\./);
  assert.match(removeRoute, /GROUP_ACTION\.CYCLE_PARTICIPATION_MANAGE/);
  assert.match(service, /assertGroupAction\(user,groupId,GROUP_ACTION\.CYCLE_PARTICIPATION_MANAGE,c\)/);
  assert.match(service, /SET status='REMOVED',ended_at=CURRENT_DATE/);
  assert.match(service, /OFFICER_REMOVED/);
  assert.match(service, /\['DRAFT','READY'\]\.includes\(old\.cycle_status\)/);
});

test("undo makes the member and position available again", () => {
  const before = getOfficerAssignmentOptions(participants, assignments);
  const after = getOfficerAssignmentOptions(participants, assignments.filter((assignment) => assignment.id !== "assignment-1"));
  assert.equal(before.eligibleParticipants.some((member) => member.member_id === "member-1"), false);
  assert.equal(after.eligibleParticipants.some((member) => member.member_id === "member-1"), true);
  assert.equal(before.availablePositions.includes("CHAIRPERSON"), false);
  assert.equal(after.availablePositions.includes("CHAIRPERSON"), true);
});

test("the form explains empty member and position states", () => {
  assert.match(component, /All eligible members already have officer positions\./);
  assert.match(component, /All officer positions have been assigned\./);
});

test("Leadership Access displays every position and reuses existing member access", () => {
  assert.deepEqual(OFFICER_POSITIONS, ["CHAIRPERSON", "RECORD_KEEPER", "BOX_KEEPER", "MONEY_COUNTER_1", "MONEY_COUNTER_2"]);
  assert.match(overview, /OFFICER_POSITIONS\.map/);
  assert.match(overview, /Not assigned/);
  assert.match(overview, /Manage Access/);
  assert.match(overview, /user\.permissions\.includes\("member_access\.manage"\)/);
  assert.match(overview, /GROUP_ACTION\.DIGITAL_ACCESS_MANAGE/);
  assert.match(overview, /`\/groups\/\$\{id\}\/members\/\$\{leader\.member_id\}`/);
});

test("database concurrency conflicts have plain-language responses", () => {
  assert.match(service, /one_active_position_per_member/);
  assert.match(service, /This member already has an officer position for this cycle\./);
  assert.match(service, /one_active_officer_position/);
  assert.match(service, /This officer position has already been assigned\./);
});

test("onboarding reuses the active-assignment panel and refreshes local data", () => {
  assert.match(onboarding, /<OfficerAssignmentPanel/);
  assert.match(onboarding, /assignment\.cycle_id===cycle\.id&&assignment\.status==='ACTIVE'/);
  assert.match(onboarding, /onChanged=\{load\}/);
  assert.match(component, /if \(onChanged\) await onChanged\(\)/);
  assert.match(component, /OFFICER_POSITIONS\.map/);
  assert.match(component, /Not assigned/);
});

test("onboarding Undo remains authorization- and editable-cycle-gated", () => {
  assert.match(onboardingPage, /canGroupAction\(user, actor, GROUP_ACTION\.CYCLE_PARTICIPATION_MANAGE\)/);
  assert.match(onboardingPage, /canManageOfficers=\{canManageOfficers\}/);
  assert.equal(isOfficerCycleEditable("DRAFT"), true);
  assert.equal(isOfficerCycleEditable("READY"), true);
  assert.equal(isOfficerCycleEditable("ACTIVE"), false);
  assert.match(component, /assignment && canEdit && confirmingId !== assignment\.id/);
});

test("cancelling confirmation leaves the assignment unchanged", () => {
  assert.match(component, /onClick=\{\(\) => setConfirmingId\(null\)\}>Cancel/);
  assert.equal((component.match(/onClick=\{\(\) => undo\(assignment\)\}/g) || []).length, 1);
});

test("officer appointment boundaries normalize to HTML date-only strings", () => {
  const fromStrings = normalizeOfficerCycleDates({ start_date: "2026-08-01", expected_end_date: "2026-09-30" });
  assert.equal(fromStrings.start_date, "2026-08-01");
  assert.equal(fromStrings.expected_end_date, "2026-09-30");

  const fromDatabaseDates = normalizeOfficerCycleDates({
    start_date: new Date(2026, 7, 1),
    expected_end_date: new Date(2026, 8, 30),
  });
  assert.equal(fromDatabaseDates.start_date, "2026-08-01");
  assert.equal(fromDatabaseDates.expected_end_date, "2026-09-30");
  assert.match(component, /min=\{appointmentMin\} max=\{appointmentMax\}/);
});

test("database DATE normalization preserves local calendar fields instead of the UTC day", () => {
  class LagosDatabaseDate extends Date {
    getFullYear() { return 2026; }
    getMonth() { return 7; }
    getDate() { return 1; }
  }
  const databaseDate = new LagosDatabaseDate("2026-07-31T23:00:00.000Z");
  assert.equal(databaseDate.toISOString().slice(0, 10), "2026-07-31");
  assert.equal(normalizeOfficerCycleDates({ start_date: databaseDate }).start_date, "2026-08-01");
});

test("both officer entry points normalize dates before the shared panel", () => {
  assert.match(officersPage, /panelCycle=normalizeOfficerCycleDates\(cycle\)/);
  assert.match(officersPage, /cycle=\{panelCycle\}/);
  assert.match(cyclesRoute, /getCycles\(id\)\)\.map\(normalizeOfficerCycleDates\)/);
  assert.match(onboarding, /api\(`\$\{base\}\/cycles`\)/);
  assert.match(onboarding, /<OfficerAssignmentPanel/);
});
