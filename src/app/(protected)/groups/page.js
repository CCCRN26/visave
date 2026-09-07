import Link from 'next/link';
import { requireAuth } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';
import { query } from '@/lib/db/query';
import { listGroups } from '@/modules/groups/group.repository';
import DataTable from '@/components/data-table';
import LocationFilterFields from '@/components/location-filter-fields';
import { formatDate } from '@/lib/utils/date';

export default async function Groups({searchParams}){
  const user=await requireAuth(),params=await searchParams;
  const data=await listGroups(pool,{user,page:Number(params.page)||1,pageSize:20,search:params.search||'',status:params.status,projectId:params.projectId,stateId:params.stateId,lgaId:params.lgaId,facilitatorId:params.facilitatorId});
  const states=user.roles.includes('SUPER_ADMIN')
    ? await query("SELECT id,name FROM states WHERE country_code='NG' ORDER BY name")
    : await query(`SELECT DISTINCT s.id,s.name FROM states s WHERE s.country_code='NG' AND (EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='PROJECT_ADMIN' AND ur.state_id IS NULL) OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=$1 AND ur.state_id=s.id) OR EXISTS(SELECT 1 FROM facilitator_profiles fp WHERE fp.user_id=$1 AND fp.state_id=s.id)) ORDER BY s.name`,[user.id]);
  return <><div className="page-header"><div><p className="eyebrow">Programme</p><h1>Savings Groups</h1><p className="muted">Manage and monitor groups inside your authorized scope.</p></div><Link className="button" href="/groups/new">+ Create Group</Link></div><form className="panel filter-bar"><label className="sr-only" htmlFor="group-search">Search groups</label><input id="group-search" name="search" placeholder="Search name or group code" defaultValue={params.search}/><label className="sr-only" htmlFor="group-status">Group status</label><select id="group-status" name="status" defaultValue={params.status||''}><option value="">All statuses</option>{['DRAFT','ONBOARDING','ACTIVE','SUSPENDED','CLOSED','ARCHIVED'].map(status=><option key={status}>{status}</option>)}</select><LocationFilterFields states={states} initialStateId={params.stateId||''} initialLgaId={params.lgaId||''}/><button>Apply filters</button></form><DataTable empty="No savings groups match these filters." rows={data.items} columns={[{key:'group_code',label:'Group Code',render:row=><Link href={`/groups/${row.id}`}>{row.group_code}</Link>},{key:'name',label:'Group Name'},{key:'project_name',label:'Project'},{key:'state_name',label:'State'},{key:'lga_name',label:'LGA'},{key:'facilitator_name',label:'Agent'},{key:'members',label:'Members'},{key:'status',label:'Status',render:row=><span className="badge">{row.status.toLowerCase()}</span>},{key:'date_formed',label:'Date Formed',render:row=>formatDate(row.date_formed)}]}/></>;
}
