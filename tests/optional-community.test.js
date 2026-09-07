import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { groupSchema } from '../src/modules/common/schemas.js';
import { publicSearchSchema } from '../src/modules/public/public.schemas.js';

const stateId='11111111-1111-4111-8111-111111111111';
const lgaId='22222222-2222-4222-8222-222222222222';
const base={name:'Community Test Group',projectId:'33333333-3333-4333-8333-333333333333',stateId,lgaId};

test('group contract requires State/LGA and normalizes optional community text',()=>{
  assert.equal(groupSchema.parse({...base,communityName:'  Sabon Gari  '}).communityName,'Sabon Gari');
  assert.equal(groupSchema.parse(base).communityName,undefined);
  assert.equal(groupSchema.parse({...base,communityName:''}).communityName,null);
  assert.equal(groupSchema.parse({...base,communityId:''}).communityId,null);
  assert.throws(()=>groupSchema.parse({...base,lgaId:undefined}));
});

test('migration 036 preserves legacy communities and enforces required group State/LGA',()=>{
  const sql=fs.readFileSync(new URL('../database/migrations/036_optional_group_community.sql',import.meta.url),'utf8');
  assert.match(sql,/ADD COLUMN community_name TEXT/);
  assert.match(sql,/SET community_name=c\.name/);
  assert.match(sql,/g\.community_id=c\.id AND g\.community_name IS NULL/);
  assert.match(sql,/state_id SET NOT NULL/);
  assert.match(sql,/lga_id SET NOT NULL/);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM communities|DROP COLUMN community_id/i);
});

test('group create, read and PATCH support free-text and legacy Community fallback',()=>{
  const service=fs.readFileSync(new URL('../src/modules/groups/group.service.js',import.meta.url),'utf8');
  const repository=fs.readFileSync(new URL('../src/modules/groups/group.repository.js',import.meta.url),'utf8');
  const edit=fs.readFileSync(new URL('../src/components/group-edit-form.js',import.meta.url),'utf8');
  assert.match(service,/community_name/);
  assert.match(service,/data\.communityName\|\|null/);
  assert.match(service,/Object\.hasOwn\(data, "communityName"\).*data\.communityId = null/s);
  assert.match(repository,/COALESCE\(g\.community_name,c\.name\) display_community_name/);
  assert.match(repository,/community_name=CASE WHEN/);
  assert.match(edit,/communityName=communityName\|\|null/);
  assert.match(edit,/includeCommunity={false}/);
});

test('Find Groups accepts only State/LGA structured geography',()=>{
  assert.deepEqual(publicSearchSchema.parse({state_id:stateId,lga_id:lgaId}),{state_id:stateId,lga_id:lgaId});
  const search=fs.readFileSync(new URL('../src/components/public-group-search.js',import.meta.url),'utf8');
  const service=fs.readFileSync(new URL('../src/modules/public/public.service.js',import.meta.url),'utf8');
  assert.doesNotMatch(search,/community_id|Community<select|locations\/communities/);
  assert.match(service,/g\.state_id=\$1 AND g\.lga_id=\$2 ORDER BY/);
  assert.doesNotMatch(service,/g\.community_id=\$3/);
  assert.match(service,/COALESCE\(g\.community_name,c\.name\) community/);
});
