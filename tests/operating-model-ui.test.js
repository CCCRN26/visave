import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component=fs.readFileSync("src/components/operating-model-panel.js","utf8");
const page=fs.readFileSync("src/app/(protected)/groups/[id]/page.js","utf8");
const publicPanel=fs.readFileSync("src/components/public-discovery-panel.js","utf8");

test("Group Overview uses authoritative readiness and operation-mode APIs",()=>{
  assert.match(component,/member-managed-readiness/);
  assert.match(component,/operation-mode/);
  assert.match(component,/method:\s*"POST"/);
  assert.match(component,/operationMode:\s*"MEMBER_MANAGED"/);
});

test("readiness blocker codes have presentation labels and a safe fallback",()=>{
  for(const code of ["GROUP_NOT_ACTIVE","NO_ACTIVE_CYCLE","CYCLE_NOT_ACTIVE","NO_APPROVED_CONSTITUTION","OFFICER_ASSIGNMENTS_INCOMPLETE","NO_RECORD_KEEPER","RECORD_KEEPER_INACTIVE","RECORD_KEEPER_NO_DIGITAL_ACCESS","NO_CHAIRPERSON","CHAIRPERSON_INACTIVE","CHAIRPERSON_NO_DIGITAL_ACCESS","NO_ACTIVE_FACILITATOR","OPEN_MEETING_EXISTS","CLOSING_TRANSITION_EXISTS"]){
    assert.match(component,new RegExp(`${code}:`));
  }
  assert.match(component,/replaceAll\("_"," "\)/);
});

test("handover UI is permission-gated and prevents duplicate submission",()=>{
  assert.match(component,/readiness\.ready&&canManageMode/);
  assert.match(component,/disabled=\{busy\}/);
  assert.match(component,/Handing over…/);
});

test("Group Overview uses centralized view access and contains no stale Phase 2C copy",()=>{
  assert.match(page,/requireGroupRouteAction\(user, id, "group\.view", GROUP_ACTION\.GROUP_VIEW\)/);
  assert.doesNotMatch(page,/Coming in Phase 2C/);
  assert.doesNotMatch(page,/Â·|â€”/);
});

test("Public Discovery reuses PATCH public-settings with every supported enum",()=>{
  assert.match(publicPanel,/public-settings/);
  assert.match(publicPanel,/method:"PATCH"/);
  for(const value of ["HIDDEN","VISIBLE","CLOSED","OPEN","OPEN_FOR_NEXT_CYCLE","WAITLIST_ONLY"])assert.match(publicPanel,new RegExp(value));
  assert.match(publicPanel,/disabled=\{busy\}/);
  assert.match(publicPanel,/router\.refresh\(\)/);
});

test("Group Overview exposes leadership access as member-profile shortcuts",()=>{
  assert.match(page,/Leadership access/);
  assert.match(page,/CHAIRPERSON/);
  assert.match(page,/RECORD_KEEPER/);
  assert.match(page,/members\/\$\{leader\.member_id\}/);
});
