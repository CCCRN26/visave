import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canGroupAction,
  GROUP_ACTION,
  isCurrentLoanChairperson,
  isLoanSameActorSodExempt,
  isLoanSelfRequester,
  requireGroupRouteAction,
} from "../src/modules/group-access/group-access.service.js";
import {
  assertLoanDecisionSeparation,
  assertLoanDisbursementSeparation,
  resolveLoanRequestMemberId,
} from "../src/modules/loans/loan.authorization.js";

const user = (role, id = role.toLowerCase()) => ({ id, organization_id: "org-1", roles: [role], permissions: [] });
const member = user("VSLA_MEMBER", "member-user");
const context = (mode = "PROGRAM_ASSISTED", overrides = {}) => ({
  operation_mode: mode,
  group_status: "ACTIVE",
  linked_member_id: null,
  member_status: null,
  active_cycle_id: "cycle-1",
  cycle_membership_id: null,
  cycle_status: "ACTIVE",
  officer_position: null,
  isChairperson: false,
  isRecordKeeper: false,
  has_program_scope: false,
  is_assigned_facilitator: false,
  is_active_facilitator: false,
  has_facilitator_scope: false,
  ...overrides,
});
const officer = (position, mode = "PROGRAM_ASSISTED", overrides = {}) => context(mode, {
  linked_member_id: "member-1",
  member_status: "ACTIVE",
  cycle_membership_id: "membership-1",
  officer_position: position,
  isChairperson: position === "CHAIRPERSON",
  isRecordKeeper: position === "RECORD_KEEPER",
  ...overrides,
});
const assignedFacilitator = context("PROGRAM_ASSISTED", {
  is_assigned_facilitator: true,
  is_active_facilitator: true,
  has_facilitator_scope: true,
});
const ordinaryMember = context("PROGRAM_ASSISTED", {
  linked_member_id: "member-self",
  member_status: "ACTIVE",
  cycle_membership_id: "membership-self",
});

test("Program Assisted request matrix is exact", () => {
  assert.equal(canGroupAction(user("FACILITATOR"), assignedFacilitator, GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(member, officer("CHAIRPERSON"), GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(member, ordinaryMember, GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(user("SUPER_ADMIN"), context(), GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(user("PROJECT_ADMIN"), context("PROGRAM_ASSISTED", { has_program_scope: true }), GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(user("STATE_COORDINATOR"), context("PROGRAM_ASSISTED", { has_program_scope: true }), GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(member, officer("RECORD_KEEPER"), GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(member, officer("BOX_KEEPER"), GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(user("FACILITATOR"), { ...assignedFacilitator, is_assigned_facilitator: false }, GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(member, { ...ordinaryMember, linked_member_id: null }, GROUP_ACTION.LOAN_REQUEST), false);
  assert.equal(canGroupAction(member, { ...ordinaryMember, member_status: "INACTIVE" }, GROUP_ACTION.LOAN_REQUEST), false);
});

test("Program Assisted decision matrix is exact", () => {
  for (const [actor, ctx] of [
    [user("SUPER_ADMIN"), context()],
    [user("FACILITATOR"), assignedFacilitator],
    [member, officer("CHAIRPERSON")],
  ]) assert.equal(canGroupAction(actor, ctx, GROUP_ACTION.LOAN_DECIDE), true);
  for (const [actor, ctx] of [
    [user("PROJECT_ADMIN"), context("PROGRAM_ASSISTED", { has_program_scope: true })],
    [user("STATE_COORDINATOR"), context("PROGRAM_ASSISTED", { has_program_scope: true })],
    [member, officer("RECORD_KEEPER")],
    [member, officer("BOX_KEEPER")],
    [member, officer("MONEY_COUNTER_1")],
    [member, ordinaryMember],
    [user("FACILITATOR"), { ...assignedFacilitator, is_assigned_facilitator: false }],
  ]) assert.equal(canGroupAction(actor, ctx, GROUP_ACTION.LOAN_DECIDE), false);
});

test("Program Assisted disbursement matrix is exact", () => {
  assert.equal(canGroupAction(user("SUPER_ADMIN"), context(), GROUP_ACTION.LOAN_DISBURSE), true);
  assert.equal(canGroupAction(user("FACILITATOR"), assignedFacilitator, GROUP_ACTION.LOAN_DISBURSE), true);
  assert.equal(canGroupAction(member, officer("CHAIRPERSON"), GROUP_ACTION.LOAN_DISBURSE), true);
  for (const [actor, ctx] of [
    [user("PROJECT_ADMIN"), context("PROGRAM_ASSISTED", { has_program_scope: true })],
    [user("STATE_COORDINATOR"), context("PROGRAM_ASSISTED", { has_program_scope: true })],
    [member, officer("RECORD_KEEPER")],
    [member, ordinaryMember],
    [user("FACILITATOR"), { ...assignedFacilitator, is_assigned_facilitator: false }],
  ]) assert.equal(canGroupAction(actor, ctx, GROUP_ACTION.LOAN_DISBURSE), false);
});

test("Member Managed matrix preserves Super Admin, Chairperson, and Record Keeper policy", () => {
  const superAdmin = user("SUPER_ADMIN");
  const mm = context("MEMBER_MANAGED");
  const chair = officer("CHAIRPERSON", "MEMBER_MANAGED");
  const keeper = officer("RECORD_KEEPER", "MEMBER_MANAGED");
  for (const action of [GROUP_ACTION.LOAN_REQUEST, GROUP_ACTION.LOAN_DECIDE, GROUP_ACTION.LOAN_DISBURSE]) {
    assert.equal(canGroupAction(superAdmin, mm, action), true, `Super Admin ${action}`);
    assert.equal(canGroupAction(member, chair, action), true, `Chairperson ${action}`);
  }
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.LOAN_DISBURSE), true);
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.LOAN_DECIDE), false);
  const ordinary = { ...ordinaryMember, operation_mode: "MEMBER_MANAGED" };
  assert.equal(canGroupAction(member, ordinary, GROUP_ACTION.LOAN_REQUEST), true);
  assert.equal(canGroupAction(member, ordinary, GROUP_ACTION.LOAN_DECIDE), false);
  assert.equal(canGroupAction(member, ordinary, GROUP_ACTION.LOAN_DISBURSE), false);
  assert.equal(canGroupAction(user("FACILITATOR"), { ...assignedFacilitator, operation_mode: "MEMBER_MANAGED" }, GROUP_ACTION.LOAN_REQUEST), false);
});

test("ordinary self-request derives and protects the linked member identity in both modes", () => {
  for (const mode of ["PROGRAM_ASSISTED", "MEMBER_MANAGED"]) {
    const actor = { ...ordinaryMember, operation_mode: mode };
    assert.equal(isLoanSelfRequester(member, actor), true);
    assert.equal(resolveLoanRequestMemberId(member, actor), "member-self");
    assert.equal(resolveLoanRequestMemberId(member, actor, "member-self"), "member-self");
    assert.throws(
      () => resolveLoanRequestMemberId(member, actor, "member-other"),
      (error) => error.code === "FORBIDDEN" && error.statusCode === 403,
      `${mode} cross-member substitution must return 403`,
    );
  }
  assert.throws(
    () => resolveLoanRequestMemberId(user("FACILITATOR"), assignedFacilitator),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("Program Assisted Super Admin, assigned Facilitator, and current Chairperson may complete the same-loan lifecycle", () => {
  const facilitator = user("FACILITATOR", "actor-1");
  const superAdmin = user("SUPER_ADMIN", "actor-1");
  for (const [actor, actorContext] of [
    [superAdmin, context("PROGRAM_ASSISTED")],
    [facilitator, assignedFacilitator],
    [member, officer("CHAIRPERSON")],
  ]) {
    assert.equal(isLoanSameActorSodExempt(actor, actorContext), true);
    assert.doesNotThrow(() => assertLoanDecisionSeparation(actor, actorContext, actor.id));
    assert.doesNotThrow(() => assertLoanDisbursementSeparation(actor, actorContext, actor.id));
  }
});

test("Program Assisted SOD exemption excludes unauthorized, stale, and cross-group actors", () => {
  const actorId = "actor-1";
  const cases = [
    [user("PROJECT_ADMIN", actorId), context("PROGRAM_ASSISTED", { has_program_scope: true })],
    [user("STATE_COORDINATOR", actorId), context("PROGRAM_ASSISTED", { has_program_scope: true })],
    [user("VSLA_MEMBER", actorId), officer("RECORD_KEEPER")],
    [user("VSLA_MEMBER", actorId), ordinaryMember],
    [user("FACILITATOR", actorId), { ...assignedFacilitator, is_assigned_facilitator: false }],
    [user("FACILITATOR", actorId), { ...assignedFacilitator, has_facilitator_scope: false }],
    [user("FACILITATOR", actorId), { ...assignedFacilitator, is_active_facilitator: false }],
    [user("VSLA_MEMBER", actorId), officer("CHAIRPERSON", "PROGRAM_ASSISTED", { officer_position: null, isChairperson: false })],
  ];
  for (const [actor, actorContext] of cases) {
    assert.equal(isLoanSameActorSodExempt(actor, actorContext), false);
    assert.throws(() => assertLoanDecisionSeparation(actor, actorContext, actorId), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION" && error.statusCode === 403);
    assert.throws(() => assertLoanDisbursementSeparation(actor, actorContext, actorId), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION" && error.statusCode === 403);
  }
});

test("Member Managed Super Admin can request, decide their own request, and disburse their own approval", async () => {
  const superAdmin = user("SUPER_ADMIN", "actor-1");
  const mm = context("MEMBER_MANAGED");
  const client = { query: async () => ({ rows: [mm] }) };
  assert.equal(isLoanSameActorSodExempt(superAdmin, mm), true);
  for (const [permission, action] of [
    ["loan.request", GROUP_ACTION.LOAN_REQUEST],
    ["loan.approve", GROUP_ACTION.LOAN_DECIDE],
    ["loan.disburse", GROUP_ACTION.LOAN_DISBURSE],
  ]) {
    assert.equal(canGroupAction(superAdmin, mm, action), true);
    await assert.doesNotReject(() => requireGroupRouteAction(
      { ...superAdmin, permissions: [permission] }, "group-1", permission, action, client,
    ));
  }
  const requestedBy = superAdmin.id;
  assert.equal(resolveLoanRequestMemberId(superAdmin, mm, "borrower-1"), "borrower-1");
  for (const decision of ["APPROVED", "REJECTED"]) {
    assert.doesNotThrow(() => assertLoanDecisionSeparation(superAdmin, mm, requestedBy), decision);
  }
  assert.doesNotThrow(() => assertLoanDisbursementSeparation(superAdmin, mm, superAdmin.id));
});

test("Member Managed Chairperson exemption and Record Keeper SOD remain intact", () => {
  const chair = officer("CHAIRPERSON");
  assert.equal(isCurrentLoanChairperson(chair), true);
  assert.doesNotThrow(() => assertLoanDecisionSeparation(member, chair, member.id));
  assert.doesNotThrow(() => assertLoanDisbursementSeparation(member, chair, member.id));
  const memberManagedChair = officer("CHAIRPERSON", "MEMBER_MANAGED");
  assert.equal(isLoanSameActorSodExempt(member, memberManagedChair), true);
  assert.doesNotThrow(() => assertLoanDecisionSeparation(member, memberManagedChair, member.id));
  assert.doesNotThrow(() => assertLoanDisbursementSeparation(member, memberManagedChair, member.id));
  const recordKeeper = officer("RECORD_KEEPER", "MEMBER_MANAGED");
  assert.equal(isLoanSameActorSodExempt(member, recordKeeper), false);
  assert.throws(() => assertLoanDecisionSeparation(member, recordKeeper, member.id), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION");
  assert.throws(() => assertLoanDisbursementSeparation(member, recordKeeper, member.id), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION");
  assert.doesNotThrow(() => assertLoanDisbursementSeparation(member, recordKeeper, "other-approver"));
});

test("Member Managed ordinary members, Facilitators, and scoped admins gain no decision, disbursement, or SOD exemption", () => {
  const mm = context("MEMBER_MANAGED");
  for (const [actor, actorContext] of [
    [member, { ...ordinaryMember, operation_mode: "MEMBER_MANAGED" }],
    [user("FACILITATOR"), { ...assignedFacilitator, operation_mode: "MEMBER_MANAGED" }],
    [user("PROJECT_ADMIN"), { ...mm, has_program_scope: true }],
    [user("STATE_COORDINATOR"), { ...mm, has_program_scope: true }],
  ]) {
    assert.equal(isLoanSameActorSodExempt(actor, actorContext), false);
    assert.equal(canGroupAction(actor, actorContext, GROUP_ACTION.LOAN_DECIDE), false);
    assert.equal(canGroupAction(actor, actorContext, GROUP_ACTION.LOAN_DISBURSE), false);
    assert.throws(() => assertLoanDecisionSeparation(actor, actorContext, actor.id), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION");
    assert.throws(() => assertLoanDisbursementSeparation(actor, actorContext, actor.id), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION");
  }
  assert.equal(isLoanSameActorSodExempt(user("SUPER_ADMIN"), context("UNKNOWN")), false);
});

test("unauthorized direct loan route guards return the normal 403 authorization error", async () => {
  const projectAdmin = user("PROJECT_ADMIN");
  const projectContext = context("PROGRAM_ASSISTED", { has_program_scope: true });
  const client = { query: async () => ({ rows: [projectContext] }) };
  for (const [permission, action] of [
    ["loan.request", GROUP_ACTION.LOAN_REQUEST],
    ["loan.approve", GROUP_ACTION.LOAN_DECIDE],
    ["loan.disburse", GROUP_ACTION.LOAN_DISBURSE],
  ]) {
    await assert.rejects(
      () => requireGroupRouteAction(projectAdmin, "group-1", permission, action, client),
      (error) => error.code === "FORBIDDEN" && error.statusCode === 403,
    );
  }
  for (const mode of ["PROGRAM_ASSISTED", "MEMBER_MANAGED"]) {
    const selfRequestClient = { query: async () => ({ rows: [{ ...ordinaryMember, operation_mode: mode }] }) };
    await assert.doesNotReject(() => requireGroupRouteAction(
      { ...member, permissions: ["loan.request"] },
      "group-1",
      "loan.request",
      GROUP_ACTION.LOAN_REQUEST,
      selfRequestClient,
    ));
  }
});

test("former and cross-group Chairpersons receive neither authority nor SOD exemption", () => {
  for (const invalid of [
    officer("CHAIRPERSON", "PROGRAM_ASSISTED", { officer_position: null, isChairperson: false }),
    officer("CHAIRPERSON", "PROGRAM_ASSISTED", { linked_member_id: null }),
    officer("CHAIRPERSON", "PROGRAM_ASSISTED", { member_status: "INACTIVE" }),
    officer("CHAIRPERSON", "PROGRAM_ASSISTED", { cycle_status: "CLOSED" }),
  ]) {
    assert.equal(isCurrentLoanChairperson(invalid), false);
    assert.equal(canGroupAction(member, invalid, GROUP_ACTION.LOAN_DECIDE), false);
    assert.throws(() => assertLoanDecisionSeparation(member, invalid, member.id), (error) => error.code === "LOAN_SEPARATION_OF_DUTIES_VIOLATION");
  }
  assert.equal(isCurrentLoanChairperson(officer("RECORD_KEEPER", "MEMBER_MANAGED")), false);
});

test("service, routes, and UI retain authoritative enforcement and actor attribution", () => {
  const service = fs.readFileSync("src/modules/loans/loan.service.js", "utf8");
  const repository = fs.readFileSync("src/modules/loans/loan.repository.js", "utf8");
  const component = fs.readFileSync("src/components/meeting-loans.js", "utf8");
  const page = fs.readFileSync("src/app/(protected)/groups/[id]/meetings/[meetingId]/page.js", "utf8");
  const selfForm = fs.readFileSync("src/components/member-loan-request-form.js", "utf8");
  for (const action of ["LOAN_REQUEST", "LOAN_DECIDE", "LOAN_DISBURSE"]) assert.match(service, new RegExp(`GROUP_ACTION\\.${action}`));
  for (const actorField of ["requested_by", "decided_by", "created_by"]) assert.match(`${service}\n${repository}`, new RegExp(actorField));
  assert.match(service, /resolveLoanRequestMemberId\(user, actor, data\.memberId\)/);
  assert.match(component, /canDecideRequest/);
  assert.match(component, /canDisburseRequest/);
  assert.match(component, /sameActorSodExempt/);
  assert.match(page, /sameActorSodExempt=\{isLoanSameActorSodExempt\(user, actor\)\}/);
  assert.match(component, /canDecide && \(sameActorSodExempt \|\| request\.requested_by !== actorUserId\)/);
  assert.match(component, /canDisburse && \(sameActorSodExempt \|\| request\.decided_by !== actorUserId\)/);
  assert.match(service, /assertLoanDecisionSeparation\(user, actor, r\.requested_by\)/);
  assert.match(service, /assertLoanDisbursementSeparation\(user, actor, r\.decided_by\)/);
  assert.match(component, /Select borrower/);
  assert.match(selfForm, /there is no borrower selector/i);
  assert.doesNotMatch(selfForm, /memberId/);
});
