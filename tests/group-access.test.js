import test from "node:test";
import assert from "node:assert/strict";
import { canGroupAction, getMyGroups, GROUP_ACTION } from "../src/modules/group-access/group-access.service.js";

const member = { id: "user-1", organization_id: "org-1", roles: ["VSLA_MEMBER"], permissions: [] };
const facilitator = { ...member, roles: ["FACILITATOR"] };
const officer = (position, mode = "PROGRAM_ASSISTED", overrides = {}) => ({
  operation_mode: mode, linked_member_id: "member-1", member_status: "ACTIVE", active_cycle_id: "cycle-1",
  cycle_status: "ACTIVE", officer_position: position, isChairperson: position === "CHAIRPERSON",
  isRecordKeeper: position === "RECORD_KEEPER", has_program_scope: false, is_assigned_facilitator: false,
  is_active_facilitator: false, has_facilitator_scope: false, ...overrides,
});

test("Chairperson has own-group views and approved operations", () => {
  const ctx = officer("CHAIRPERSON");
  for (const action of [GROUP_ACTION.GROUP_VIEW, GROUP_ACTION.MEMBER_VIEW, GROUP_ACTION.CYCLE_VIEW,
    GROUP_ACTION.MEETING_VIEW, GROUP_ACTION.LOAN_VIEW, GROUP_ACTION.SHAREOUT_VIEW, GROUP_ACTION.ATTENDANCE_OPERATE,
    GROUP_ACTION.FINANCIAL_OPERATE, GROUP_ACTION.FINANCIAL_REVERSE, GROUP_ACTION.LOAN_REPAY,
    GROUP_ACTION.RECONCILIATION_OPERATE, GROUP_ACTION.MEETING_OPERATE]) assert.equal(canGroupAction(member, ctx, action), true, action);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.LOAN_OPERATE), false);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.LOAN_DECIDE), true);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.LOAN_DISBURSE), false);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.SHAREOUT_OPERATE), false);
});

test("Chairperson member-managed constitution and cycle authority is narrow", () => {
  const ctx = officer("CHAIRPERSON", "MEMBER_MANAGED");
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.CONSTITUTION_MANAGE), true);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.CYCLE_MANAGE), true);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.CYCLE_CLOSE), true);
  assert.equal(canGroupAction(member, ctx, GROUP_ACTION.OFFICER_MANAGE), false);
  for(const action of [GROUP_ACTION.SHAREOUT_VIEW,GROUP_ACTION.SHAREOUT_PREPARE,GROUP_ACTION.SHAREOUT_APPROVE,GROUP_ACTION.SHAREOUT_PAYOUT,GROUP_ACTION.SHAREOUT_COMPLETE])
    assert.equal(canGroupAction(member,ctx,action),true,action);
  const closing={...ctx,cycle_status:"CLOSING"};
  assert.equal(canGroupAction(member,closing,GROUP_ACTION.CYCLE_CLOSE),true);
  const closed={...ctx,cycle_status:"CLOSED"};
  assert.equal(canGroupAction(member,closed,GROUP_ACTION.SHAREOUT_APPROVE),false);
  assert.equal(canGroupAction(member,closed,GROUP_ACTION.CYCLE_MANAGE),true);
});

test("Record Keeper PA is view-only and MM retains operations", () => {
  const pa = officer("RECORD_KEEPER");
  const mm = officer("RECORD_KEEPER", "MEMBER_MANAGED");
  assert.equal(canGroupAction(member, pa, GROUP_ACTION.MEETING_VIEW), true);
  assert.equal(canGroupAction(member, pa, GROUP_ACTION.FINANCIAL_OPERATE), false);
  assert.equal(canGroupAction(member, mm, GROUP_ACTION.MEETING_OPERATE), true);
  assert.equal(canGroupAction(member, mm, GROUP_ACTION.LOAN_REPAY), true);
  assert.equal(canGroupAction(member, mm, GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(member, mm, GROUP_ACTION.LOAN_DISBURSE), true);
  assert.equal(canGroupAction(member, mm, GROUP_ACTION.LOAN_DECIDE), false);
  assert.equal(canGroupAction(member, mm, GROUP_ACTION.CONSTITUTION_MANAGE), false);
  assert.equal(canGroupAction(member,{...mm,cycle_status:"CLOSING"},GROUP_ACTION.SHAREOUT_PAYOUT),true);
  assert.equal(canGroupAction(member,{...mm,cycle_status:"CLOSING"},GROUP_ACTION.SHAREOUT_APPROVE),false);
  assert.equal(canGroupAction(member,{...mm,cycle_status:"CLOSING"},GROUP_ACTION.CYCLE_CLOSE),false);
});

test("inactive, former, closed-cycle, ordinary, and cross-group relationships are denied", () => {
  for (const ctx of [officer("CHAIRPERSON", "PROGRAM_ASSISTED", { member_status: "INACTIVE" }),
    officer(null), officer("CHAIRPERSON", "PROGRAM_ASSISTED", { cycle_status: "CLOSED" }),
    officer("CHAIRPERSON", "PROGRAM_ASSISTED", { linked_member_id: null })]) {
    assert.equal(canGroupAction(member, ctx, GROUP_ACTION.GROUP_VIEW), false);
  }
});

test("Facilitator PA mutations pass while MM is read-only", () => {
  const base = officer(null, "PROGRAM_ASSISTED", { linked_member_id: null, is_assigned_facilitator: true,
    is_active_facilitator: true, has_facilitator_scope: true });
  assert.equal(canGroupAction(facilitator, base, GROUP_ACTION.FINANCIAL_OPERATE), true);
  assert.equal(canGroupAction(facilitator, base, GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(facilitator, base, GROUP_ACTION.LOAN_DISBURSE), true);
  assert.equal(canGroupAction(facilitator, base, GROUP_ACTION.LOAN_DECIDE), false);
  assert.equal(canGroupAction(facilitator, { ...base, operation_mode: "MEMBER_MANAGED" }, GROUP_ACTION.FINANCIAL_OPERATE), false);
  assert.equal(canGroupAction(facilitator, { ...base, operation_mode: "MEMBER_MANAGED" }, GROUP_ACTION.FINANCIAL_VIEW), true);
  assert.equal(canGroupAction(facilitator, { ...base, operation_mode: "MEMBER_MANAGED" }, GROUP_ACTION.DIGITAL_ACCESS_MANAGE), true);
  assert.equal(canGroupAction(facilitator, { ...base, operation_mode: "MEMBER_MANAGED" }, GROUP_ACTION.MEMBER_MANAGE), false);
  assert.equal(canGroupAction(facilitator, { ...base, is_assigned_facilitator: false }, GROUP_ACTION.GROUP_VIEW), false);
  assert.equal(canGroupAction(facilitator, { ...base, is_assigned_facilitator: false }, GROUP_ACTION.DIGITAL_ACCESS_MANAGE), false);
});

test("My Groups includes active linked ordinary memberships and preserves officer routing metadata", async () => {
  let sql = "";
  await getMyGroups(member, { query: async (text) => { sql = text; return { rows: [] }; } });
  assert.match(sql, /m\.status='ACTIVE'/); assert.match(sql, /cy\.id IS NOT NULL/);
  assert.match(sql, /has_officer_workspace/);
  assert.doesNotMatch(sql, /AND oa\.position_code IN/);
  assert.match(sql, /m\.linked_user_id=\$1/);
});

test("program-scoped admins manage digital access while members and officers do not gain that action", () => {
  const adminContext = officer(null, "PROGRAM_ASSISTED", { linked_member_id: null, has_program_scope: true });
  assert.equal(canGroupAction({ ...member, roles: ["PROJECT_ADMIN"] }, adminContext, GROUP_ACTION.DIGITAL_ACCESS_MANAGE), true);
  assert.equal(canGroupAction(member, officer("CHAIRPERSON"), GROUP_ACTION.DIGITAL_ACCESS_MANAGE), false);
  assert.equal(canGroupAction(member, officer("RECORD_KEEPER", "MEMBER_MANAGED"), GROUP_ACTION.DIGITAL_ACCESS_MANAGE), false);
  assert.equal(canGroupAction(member, officer(null), GROUP_ACTION.DIGITAL_ACCESS_MANAGE), false);
});
