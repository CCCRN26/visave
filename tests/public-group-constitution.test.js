import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const service=read('../src/modules/public/public.service.js');
const page=read('../src/app/find-a-group/[id]/page.js');
const publicDownload=read('../src/app/api/public/groups/[id]/constitution/route.js');
const protectedDownload=read('../src/app/api/v1/groups/[id]/constitution/[constitutionId]/document/route.js');

test('public group profile returns approved Constitution summary without private document metadata',()=>{
  const detailService=service.slice(service.indexOf('export async function publicGroup'),service.indexOf('export async function downloadPublicConstitution'));
  for(const field of ['share_value','min_shares_per_meeting','max_shares_per_meeting','social_fund_contribution','loan_max_multiple','loan_service_charge_rate','loan_max_term_months','meeting_frequency','quorum_percentage','fine_rules']) assert.match(detailService,new RegExp(field));
  assert.match(detailService,/c\.status='APPROVED'/);
  assert.match(detailService,/d\.archived_at IS NULL AND d\.replaced_by_document_id IS NULL/);
  assert.doesNotMatch(detailService,/storage_key|sha256|file_size_bytes|uploaded_by_user_id/);
});

test('public profile handles Constitution document and empty states',()=>{
  assert.match(page,/constitution\?\.has_document&&<a/);
  assert.match(page,/api\/public\/groups\/\$\{group\.public_id\}\/constitution/);
  assert.match(page,/Download Constitution/);
  assert.match(page,/Constitution document has not been uploaded\./);
  assert.match(page,/No Constitution information is currently available\./);
  assert.match(page,/group\.community,`\$\{group\.lga\} LGA`,`\$\{group\.state\} State`/);
  assert.match(page,/group\.group_name/);
});

test('public Constitution download is limited to current approved documents of discoverable groups',()=>{
  const downloadService=service.slice(service.indexOf('export async function downloadPublicConstitution'));
  for(const guard of [
    /c\.group_id=d\.group_id AND c\.status='APPROVED'/,
    /g\.id=\$1/,
    /g\.public_visibility='VISIBLE'/,
    /g\.membership_intake_status<>'CLOSED'/,
    /g\.status<>'ARCHIVED'/,
    /p\.status='ACTIVE'/,
    /d\.archived_at IS NULL/,
    /d\.replaced_by_document_id IS NULL/,
  ]) assert.match(downloadService,guard);
  assert.match(publicDownload,/'Content-Type':'application\/pdf'/);
  assert.match(publicDownload,/safeFilename=String\(filename\|\|'constitution\.pdf'\)\.replace/);
  assert.doesNotMatch(publicDownload,/storage_key|sha256|file_size_bytes/);
});

test('Find Groups filtering and authenticated Constitution download remain intact',()=>{
  assert.match(service,/g\.state_id=\$1 AND g\.lga_id=\$2 ORDER BY g\.name/);
  assert.match(protectedDownload,/requireAuth\(\)/);
  assert.match(protectedDownload,/requireGroupRouteAction/);
  assert.match(protectedDownload,/downloadConstitutionDocument/);
});
