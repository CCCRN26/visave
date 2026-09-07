import test from "node:test";
import assert from "node:assert/strict";
import { dashboardScopeSql, resolveDashboardScope } from "../src/modules/dashboard/dashboard-scope.js";

const base={id:"user-1",organization_id:"org-1",roles:[]};
const client=(rows=[])=>({query:async()=>({rows})});

test("dashboard precedence keeps program roles above facilitator and group membership",async()=>{
  assert.deepEqual(await resolveDashboardScope({...base,roles:["SUPER_ADMIN","FACILITATOR"]},client()),{scopeType:"ORGANIZATION",groupId:null});
  assert.deepEqual(await resolveDashboardScope({...base,roles:["PROJECT_ADMIN","VSLA_MEMBER"]},client()),{scopeType:"ORGANIZATION",groupId:null});
  assert.deepEqual(await resolveDashboardScope({...base,roles:["FACILITATOR","VSLA_MEMBER"]},client([{group_id:"ignored"}])),{scopeType:"FACILITATOR",groupId:null});
});

test("dashboard resolves current active digitally linked officer groups",async()=>{
  let sql="";const db={query:async(text)=>{sql=text;return{rows:[{group_id:"group-a"}]}}};
  assert.deepEqual(await resolveDashboardScope({...base,roles:["VSLA_MEMBER"]},db),{scopeType:"GROUPS",groupId:null,groupIds:["group-a"]});
  assert.match(sql,/cy\.status='ACTIVE'/);
  assert.match(sql,/oa\.status='ACTIVE'/);
  assert.doesNotMatch(sql,/oa\.position_code=/);
  assert.match(sql,/gm\.status='ACTIVE'/);
  assert.match(sql,/g\.organization_id=\$2/);
});

test("dashboard never falls back to organization data without an officer assignment",async()=>{
  assert.deepEqual(await resolveDashboardScope({...base,roles:["VSLA_MEMBER"]},client([])),{scopeType:"NO_ACTIVE_GROUP",groupId:null});
  assert.deepEqual(await resolveDashboardScope({...base,roles:["VSLA_MEMBER"]},client([{group_id:"a"},{group_id:"b"}])),{scopeType:"GROUPS",groupId:null,groupIds:["a","b"]});
});

test("reusable dashboard SQL enforces organization, project/state, facilitator and group scope",()=>{
  const sql=dashboardScopeSql();
  assert.match(sql,/g\.organization_id=\$1/);
  assert.match(sql,/g\.status<>'ARCHIVED'/);
  assert.match(sql,/r\.code IN \('PROJECT_ADMIN','STATE_COORDINATOR'\)/);
  assert.match(sql,/ur\.project_id=g\.project_id/);
  assert.match(sql,/ur\.state_id IS NULL OR ur\.state_id=g\.state_id/);
  assert.match(sql,/g\.facilitator_user_id=\$2/);
  assert.match(sql,/g\.id=ANY\(\$5::uuid\[\]\)/);
});
