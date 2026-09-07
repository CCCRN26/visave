import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const geography=JSON.parse(fs.readFileSync(new URL('../database/data/nigeria-geography.json',import.meta.url),'utf8'));
const byName=(name)=>geography.states.find((state)=>state.name===name);

test('canonical Nigeria geography contains exactly 37 State/FCT units and 774 LGAs',()=>{
  assert.equal(geography.states.length,37);
  assert.equal(geography.states.reduce((total,state)=>total+state.lgas.length,0),774);
  assert.ok(geography.states.every((state)=>state.lgas.length>0));
  assert.ok(geography.states.every((state)=>new Set(state.lgas.map((lga)=>lga.name)).size===state.lgas.length));
});

test('required State-specific geography is canonical',()=>{
  assert.equal(byName('Niger').lgas.length,25);
  assert.equal(byName('Lagos').lgas.length,20);
  assert.equal(byName('Federal Capital Territory').lgas.length,6);
  assert.ok(byName('Niger').lgas.some(({name})=>name==='Chanchaga'));
  assert.ok(byName('Lagos').lgas.some(({name})=>name==='Ikeja'));
  assert.deepEqual(byName('Federal Capital Territory').lgas.map(({name})=>name).sort(),['Abaji','Abuja Municipal Area Council','Bwari','Gwagwalada','Kuje','Kwali']);
  assert.ok(!geography.states.some((state)=>state.lgas.some(({name})=>name==='Minna')));
});

test('migration upserts by natural keys and installs composite hierarchy constraints',()=>{
  const sql=fs.readFileSync(new URL('../database/migrations/035_nigeria_geography.sql',import.meta.url),'utf8');
  assert.match(sql,/ON CONFLICT\(country_code,name\) DO UPDATE/);
  assert.match(sql,/ON CONFLICT\(state_id,name\) DO UPDATE/);
  assert.match(sql,/FOREIGN KEY\(lga_id,state_id\) REFERENCES lgas\(id,state_id\)/);
  assert.match(sql,/FOREIGN KEY\(community_id,lga_id\) REFERENCES communities\(id,lga_id\)/);
  assert.doesNotMatch(sql,/DELETE FROM (states|lgas|communities)/i);
});

test('group geography keeps dependent State/LGA loading without a structured Community selector',()=>{
  const component=fs.readFileSync(new URL('../src/components/dependent-location-fields.js',import.meta.url),'utf8');
  const groupCreate=fs.readFileSync(new URL('../src/app/(protected)/groups/new/page.js',import.meta.url),'utf8');
  for(const source of [component,groupCreate]) assert.match(source,/AbortController/);
  assert.match(component,/lgaId:'',communityId:''/);
  assert.match(component,/communityId:''/);
  assert.match(component,/disabled={!value\.stateId/);
  assert.match(component,/disabled={!value\.lgaId/);
  assert.match(groupCreate,/locations\/lgas\?stateId=/);
  assert.match(groupCreate,/name="communityName"/);
  assert.doesNotMatch(groupCreate,/name="communityId"|locations\/communities\?lgaId=/);
});

test('group PATCH validates the merged final hierarchy before persistence',()=>{
  const service=fs.readFileSync(new URL('../src/modules/groups/group.service.js',import.meta.url),'utf8');
  const route=fs.readFileSync(new URL('../src/app/api/v1/groups/[id]/route.js',import.meta.url),'utf8');
  assert.match(service,/Object\.hasOwn\(data, "stateId"\).*current\.state_id/s);
  assert.match(service,/Object\.hasOwn\(data, "lgaId"\).*current\.lga_id/s);
  assert.match(service,/validateLocationHierarchy[\s\S]*updateGroup/);
  assert.match(route,/updateScopedGroup/);
});
