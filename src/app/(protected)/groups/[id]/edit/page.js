import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/session';
import { requireGroupRouteAction, GROUP_ACTION } from '@/modules/group-access/group-access.service';
import { query } from '@/lib/db/query';
import { formatDateForInput } from '@/lib/utils/date';
import GroupEditForm from '@/components/group-edit-form';

export default async function EditGroup({params}){
  const{id}=await params,user=await requireAuth();
  await requireGroupRouteAction(user,id,'group.update',GROUP_ACTION.GROUP_MANAGE);
  const[group]=await query('SELECT g.*,COALESCE(g.community_name,c.name) display_community_name FROM vsla_groups g LEFT JOIN communities c ON c.id=g.community_id WHERE g.id=$1 AND g.organization_id=$2',[id,user.organization_id]);
  if(!group)notFound();
  const states=user.roles.includes('SUPER_ADMIN')
    ? await query("SELECT id,name FROM states WHERE country_code='NG' ORDER BY name")
    : await query(`SELECT DISTINCT s.id,s.name FROM states s WHERE s.country_code='NG' AND (EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='PROJECT_ADMIN' AND ur.state_id IS NULL) OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=$1 AND ur.state_id=s.id) OR EXISTS(SELECT 1 FROM facilitator_profiles fp WHERE fp.user_id=$1 AND fp.state_id=s.id)) ORDER BY s.name`,[user.id]);
  const initial={id:group.id,name:group.name,state_id:group.state_id,lga_id:group.lga_id,community_id:group.community_id,community_name:group.community_name,display_community_name:group.display_community_name,date_formed:formatDateForInput(group.date_formed),meeting_location:group.meeting_location};
  return <><h1>Edit {group.name}</h1><p className="muted">Location changes are checked against your existing group-management scope and the geographic hierarchy.</p><GroupEditForm group={initial} states={states}/></>;
}
