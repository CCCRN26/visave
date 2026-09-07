import bcrypt from 'bcryptjs';
import {pool} from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import {writeAudit} from '@/lib/audit/audit.service';
import {AppError,AuthorizationError,ConflictError,NotFoundError} from '@/lib/errors';
import {assertGroupAction,getGroupActorContext,GROUP_ACTION} from '@/modules/group-access/group-access.service';

const domain=(code,message,status=409,details)=>new AppError(message,code,status,details);

async function assertAccessManager(client,user,groupId){
  return assertGroupAction(user,groupId,GROUP_ACTION.DIGITAL_ACCESS_MANAGE,client);
}
async function assertModeManager(client,user,groupId){
  const ctx=await getGroupActorContext(user,groupId,client);
  if(ctx.has_program_scope)return ctx;
  throw new AuthorizationError();
}

export async function getMemberManagedReadiness(groupId,user,client=pool){
  await assertModeManager(client,user,groupId);
  const proof=(await client.query(`
    SELECT g.id,g.status group_status,g.operation_mode,g.facilitator_user_id,
      cy.id active_cycle_id,cy.status cycle_status,gc.status constitution_status,
      COALESCE(o.officer_count,0)::int officer_count,o.record_keeper_id,o.record_keeper_status,
      o.record_keeper_user_id,o.record_keeper_user_status,o.chairperson_id,o.chairperson_status,
      o.chairperson_user_id,o.chairperson_user_status,
      fp.status facilitator_status,fu.status facilitator_user_status,
      EXISTS(SELECT 1 FROM vsla_meetings vm WHERE vm.group_id=g.id AND vm.status='OPEN') open_meeting,
      EXISTS(SELECT 1 FROM cycle_shareouts cs WHERE cs.cycle_id=cy.id AND cs.status IN('DRAFT','APPROVED','PAYOUT_IN_PROGRESS')) closing_transition
    FROM vsla_groups g
    LEFT JOIN vsla_cycles cy ON cy.group_id=g.id AND cy.status='ACTIVE'
    LEFT JOIN group_constitutions gc ON gc.id=cy.constitution_id
    LEFT JOIN facilitator_profiles fp ON fp.user_id=g.facilitator_user_id
    LEFT JOIN users fu ON fu.id=g.facilitator_user_id
    LEFT JOIN LATERAL(
      SELECT COUNT(*) FILTER(WHERE oa.status='ACTIVE') officer_count,
        (ARRAY_AGG(oa.member_id) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='RECORD_KEEPER'))[1] record_keeper_id,
        MAX(m.status) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='RECORD_KEEPER') record_keeper_status,
        (ARRAY_AGG(m.linked_user_id) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='RECORD_KEEPER'))[1] record_keeper_user_id,
        MAX(u.status) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='RECORD_KEEPER') record_keeper_user_status,
        (ARRAY_AGG(oa.member_id) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='CHAIRPERSON'))[1] chairperson_id,
        MAX(m.status) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='CHAIRPERSON') chairperson_status,
        (ARRAY_AGG(m.linked_user_id) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='CHAIRPERSON'))[1] chairperson_user_id,
        MAX(u.status) FILTER(WHERE oa.status='ACTIVE' AND oa.position_code='CHAIRPERSON') chairperson_user_status
      FROM group_officer_assignments oa JOIN group_members m ON m.id=oa.member_id
      LEFT JOIN users u ON u.id=m.linked_user_id WHERE oa.cycle_id=cy.id
    )o ON true WHERE g.id=$1
  `,[groupId])).rows[0];
  if(!proof)throw new NotFoundError('Group not found');
  const blockingIssues=[];
  if(proof.group_status!=='ACTIVE')blockingIssues.push('GROUP_NOT_ACTIVE');
  if(!proof.active_cycle_id)blockingIssues.push('NO_ACTIVE_CYCLE');
  else if(proof.cycle_status!=='ACTIVE')blockingIssues.push('CYCLE_NOT_ACTIVE');
  if(proof.constitution_status!=='APPROVED')blockingIssues.push('NO_APPROVED_CONSTITUTION');
  if(proof.officer_count!==5)blockingIssues.push('OFFICER_ASSIGNMENTS_INCOMPLETE');
  if(!proof.record_keeper_id)blockingIssues.push('NO_RECORD_KEEPER');
  else if(proof.record_keeper_status!=='ACTIVE')blockingIssues.push('RECORD_KEEPER_INACTIVE');
  else if(!proof.record_keeper_user_id||proof.record_keeper_user_status!=='ACTIVE')blockingIssues.push('RECORD_KEEPER_NO_DIGITAL_ACCESS');
  if(!proof.chairperson_id)blockingIssues.push('NO_CHAIRPERSON');
  else if(proof.chairperson_status!=='ACTIVE')blockingIssues.push('CHAIRPERSON_INACTIVE');
  else if(!proof.chairperson_user_id||proof.chairperson_user_status!=='ACTIVE')blockingIssues.push('CHAIRPERSON_NO_DIGITAL_ACCESS');
  if(!proof.facilitator_user_id||proof.facilitator_status!=='ACTIVE'||proof.facilitator_user_status!=='ACTIVE')blockingIssues.push('NO_ACTIVE_FACILITATOR');
  if(proof.open_meeting)blockingIssues.push('OPEN_MEETING_EXISTS');
  if(proof.closing_transition)blockingIssues.push('CLOSING_TRANSITION_EXISTS');
  return{ready:blockingIssues.length===0,blockingIssues,warnings:[],proof};
}

export async function changeOperationMode(groupId,data,user){
  return withTransaction(async client=>{
    const ctx=await assertModeManager(client,user,groupId);
    await client.query('SELECT 1 FROM vsla_groups WHERE id=$1 FOR UPDATE',[groupId]);
    if(ctx.operation_mode===data.operationMode)throw domain('GROUP_OPERATION_MODE_UNCHANGED','Group already uses this operating mode');
    if(data.operationMode==='MEMBER_MANAGED'){
      const readiness=await getMemberManagedReadiness(groupId,user,client);
      if(!readiness.ready)throw domain('MEMBER_MANAGED_NOT_READY','Group is not ready for member-managed operation',409,readiness);
    }else if((await client.query("SELECT 1 FROM vsla_meetings WHERE group_id=$1 AND status='OPEN'",[groupId])).rowCount){
      throw domain('OPEN_MEETING_PREVENTS_MODE_CHANGE','An open meeting prevents operating-mode fallback');
    }
    const changed=(await client.query('UPDATE vsla_groups SET operation_mode=$2,updated_at=now() WHERE id=$1 RETURNING id,operation_mode',[groupId,data.operationMode])).rows[0];
    await writeAudit(client,{organizationId:ctx.organization_id,actorUserId:user.id,action:'GROUP_OPERATION_MODE_CHANGED',entityType:'VSLA_GROUP',entityId:groupId,oldValues:{operationMode:ctx.operation_mode},newValues:{operationMode:data.operationMode,reason:data.reason||null}});
    return changed;
  });
}

export async function enableDigitalAccess(groupId,memberId,data,user){
  try{return await withTransaction(async client=>{
    const ctx=await assertAccessManager(client,user,groupId);
    const member=(await client.query('SELECT * FROM group_members WHERE id=$1 AND group_id=$2 AND organization_id=$3 FOR UPDATE',[memberId,groupId,user.organization_id])).rows[0];
    if(!member)throw new NotFoundError('Member not found');
    if(member.status!=='ACTIVE')throw domain('DIGITAL_ACCESS_REQUIRES_ACTIVE_MEMBER','Digital access can only be enabled for an active member.',400);
    if(member.linked_user_id)throw domain('MEMBER_ALREADY_LINKED','Member already has digital access');
    let target;
    if(data.mode==='CREATE_USER'){
      const hash=await bcrypt.hash(data.password,12);
      target=(await client.query(`INSERT INTO users(organization_id,first_name,last_name,email,phone,password_hash,status,must_change_password,created_by) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',true,$7) RETURNING id,organization_id,first_name,last_name,email,phone,status`,[user.organization_id,data.firstName,data.lastName,data.email,data.phone||null,hash,user.id])).rows[0];
    }else{
      target=(await client.query("SELECT id,organization_id,first_name,last_name,email,phone,status FROM users WHERE id=$1 AND organization_id=$2 AND status='ACTIVE'",[data.userId,user.organization_id])).rows[0];
      if(!target)throw domain('INVALID_MEMBER_USER_LINK','The selected active user is not available',400);
    }
    if((await client.query('SELECT 1 FROM group_members WHERE group_id=$1 AND linked_user_id=$2',[groupId,target.id])).rowCount)throw domain('USER_ALREADY_LINKED','User is already linked to a member in this group');
    await client.query(`INSERT INTO user_roles(user_id,role_id,project_id,state_id,created_by) SELECT $1,r.id,$2,$3,$4 FROM roles r WHERE r.code='VSLA_MEMBER' AND NOT EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=$1 AND ur.role_id=r.id AND ur.project_id=$2 AND ur.state_id=$3)`,[target.id,ctx.project_id,ctx.state_id,user.id]);
    await client.query('UPDATE group_members SET linked_user_id=$2,updated_at=now() WHERE id=$1',[memberId,target.id]);
    await writeAudit(client,{organizationId:user.organization_id,actorUserId:user.id,action:data.mode==='CREATE_USER'?'MEMBER_DIGITAL_ACCESS_ENABLED':'MEMBER_USER_LINKED',entityType:'GROUP_MEMBER',entityId:memberId,newValues:{groupId,userId:target.id,mode:data.mode}});
    return{memberId,user:{...target},created:data.mode==='CREATE_USER'};
  });}catch(error){if(error?.code==='23505'&&error.constraint==='users_org_email_unique')throw domain('USER_EMAIL_ALREADY_EXISTS','An application user with this email already exists');throw error}}

export async function disableDigitalAccess(groupId,memberId,user){
  return withTransaction(async client=>{
    await assertAccessManager(client,user,groupId);
    const member=(await client.query('SELECT * FROM group_members WHERE id=$1 AND group_id=$2 AND organization_id=$3 FOR UPDATE',[memberId,groupId,user.organization_id])).rows[0];
    if(!member)throw new NotFoundError('Member not found');
    if(!member.linked_user_id)throw new ConflictError('Member digital access is already disabled');
    await client.query('UPDATE group_members SET linked_user_id=NULL,updated_at=now() WHERE id=$1',[memberId]);
    await writeAudit(client,{organizationId:user.organization_id,actorUserId:user.id,action:'MEMBER_DIGITAL_ACCESS_DISABLED',entityType:'GROUP_MEMBER',entityId:memberId,oldValues:{userId:member.linked_user_id},newValues:{userId:null}});
    return{memberId,disabled:true};
  });
}
