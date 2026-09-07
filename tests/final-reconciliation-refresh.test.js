import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canGroupAction, GROUP_ACTION } from "../src/modules/group-access/group-access.service.js";
import { formatDateTime } from "../src/lib/utils/date.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const user = { roles: ["VSLA_MEMBER"] };
const base = { operation_mode: "MEMBER_MANAGED", cycle_status: "CLOSING", member_status: "ACTIVE", linked_member_id: "member", active_cycle_id: "cycle", has_program_scope: false, is_assigned_facilitator: false, has_facilitator_scope: false };

test("refresh preserves existing officer authority without expanding ordinary member or facilitator access", () => {
  assert.equal(canGroupAction(user, { ...base, officer_position: "CHAIRPERSON", isChairperson: true, isRecordKeeper: false }, GROUP_ACTION.RECONCILIATION_OPERATE), true);
  assert.equal(canGroupAction(user, { ...base, officer_position: "RECORD_KEEPER", isChairperson: false, isRecordKeeper: true }, GROUP_ACTION.RECONCILIATION_OPERATE), true);
  assert.equal(canGroupAction(user, { ...base, isChairperson: false, isRecordKeeper: false }, GROUP_ACTION.RECONCILIATION_OPERATE), false);
  assert.equal(canGroupAction({ roles: ["FACILITATOR"] }, { ...base, isChairperson: false, isRecordKeeper: false, is_assigned_facilitator: true, is_active_facilitator: true, has_facilitator_scope: true }, GROUP_ACTION.RECONCILIATION_OPERATE), false);
});

test("refresh API uses existing action-aware authorization and requires a new reconciliation signature", () => {
  const route = source("../src/app/api/v1/groups/[id]/cycles/[cycleId]/final-reconciliation/route.js");
  assert.match(route, /GROUP_ACTION\.RECONCILIATION_OPERATE/);
  assert.match(route, /reconciliationSchema/);
});

test("refresh remains append-only, locked, state-gated and transaction-type constrained", () => {
  const service = source("../src/modules/meetings/meeting.service.js");
  for (const expected of ["cycle.status==='CLOSING'", "shareout?.status==='COMPLETED'", "meeting?.status==='CLOSED'", "FOR UPDATE", "FINAL_RECONCILIATION_UNEXPECTED_ACTIVITY", "FINAL_RECONCILIATION_REFRESHED"]) assert.ok(service.includes(expected));
  assert.doesNotMatch(service, /UPDATE meeting_reconciliations/);
});

test("existing schema already permits reconciliation history", () => {
  const migration = source("../database/migrations/016_phase_2b_meetings_ledger.sql");
  assert.match(migration, /CREATE INDEX reconciliations_meeting_created_idx/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(meeting_id\)/);
});

test("reconciliation timestamps render deterministically across midnight", () => {
  const cases = [
    ["2026-09-03T00:52:00+01:00", "03 Sept 2026, 12:52 am"],
    ["2026-09-03T00:00:00+01:00", "03 Sept 2026, 12:00 am"],
    ["2026-09-03T12:52:00+01:00", "03 Sept 2026, 12:52 pm"],
    ["2026-09-03T23:59:00+01:00", "03 Sept 2026, 11:59 pm"],
  ];
  for (const [timestamp, expected] of cases) {
    const serverRendered = formatDateTime(timestamp);
    const clientInitialRender = formatDateTime(timestamp);
    assert.equal(serverRendered, expected);
    assert.equal(clientInitialRender, expected);
  }
  const utility = source("../src/lib/utils/date.js");
  assert.match(utility, /timeZone:\s*"Africa\/Lagos"/);
  assert.match(utility, /hourCycle:\s*"h12"/);
  assert.doesNotMatch(utility, /suppressHydrationWarning/);
});

test("successful refresh reloads authoritative close-out state", () => {
  const component = source("../src/components/final-reconciliation-refresh.js");
  assert.match(component, /if \(!response\.ok\) throw/);
  assert.match(component, /setOpen\(false\); router\.refresh\(\)/);
});
