import {pool} from '../../lib/db/pool.js';
import {AuthorizationError,ConflictError,NotFoundError} from '../../lib/errors/index.js';
import {requirePermission} from '../../lib/permissions/check.js';
import * as repo from './group-access.repository.js';

export const GROUP_ACTION=Object.freeze({
  GROUP_VIEW:'GROUP_VIEW',GROUP_MANAGE:'GROUP_MANAGE',MEMBER_VIEW:'MEMBER_VIEW',MEMBER_MANAGE:'MEMBER_MANAGE',CYCLE_PARTICIPATION_MANAGE:'CYCLE_PARTICIPATION_MANAGE',
  OFFICER_VIEW:'OFFICER_VIEW',OFFICER_MANAGE:'OFFICER_MANAGE',
  CONSTITUTION_VIEW:'CONSTITUTION_VIEW',CONSTITUTION_MANAGE:'CONSTITUTION_MANAGE',
  CYCLE_VIEW:'CYCLE_VIEW',CYCLE_MANAGE:'CYCLE_MANAGE',CYCLE_CLOSE:'CYCLE_CLOSE',
  MEETING_VIEW:'MEETING_VIEW',MEETING_OPERATE:'MEETING_OPERATE',
  ATTENDANCE_VIEW:'ATTENDANCE_VIEW',ATTENDANCE_OPERATE:'ATTENDANCE_OPERATE',
  FINANCIAL_VIEW:'FINANCIAL_VIEW',FINANCIAL_OPERATE:'FINANCIAL_OPERATE',FINANCIAL_REVERSE:'FINANCIAL_REVERSE',
  LOAN_VIEW:'LOAN_VIEW',LOAN_REQUEST:'LOAN_REQUEST',LOAN_DECIDE:'LOAN_DECIDE',LOAN_DISBURSE:'LOAN_DISBURSE',LOAN_OPERATE:'LOAN_OPERATE',LOAN_REPAY:'LOAN_REPAY',
  RECONCILIATION_VIEW:'RECONCILIATION_VIEW',RECONCILIATION_OPERATE:'RECONCILIATION_OPERATE',
  SHAREOUT_VIEW:'SHAREOUT_VIEW',SHAREOUT_PREPARE:'SHAREOUT_PREPARE',SHAREOUT_APPROVE:'SHAREOUT_APPROVE',SHAREOUT_PAYOUT:'SHAREOUT_PAYOUT',SHAREOUT_COMPLETE:'SHAREOUT_COMPLETE',SHAREOUT_OPERATE:'SHAREOUT_OPERATE',
  REPORT_VIEW:'REPORT_VIEW',REPORT_EXPORT:'REPORT_EXPORT',
  GROUP_ARCHIVE:'GROUP_ARCHIVE',DIGITAL_ACCESS_MANAGE:'DIGITAL_ACCESS_MANAGE',OPERATION_MODE_VIEW:'OPERATION_MODE_VIEW',OPERATION_MODE_MANAGE:'OPERATION_MODE_MANAGE',
  VIEW:'GROUP_VIEW',
});

const VIEW_ACTIONS=new Set([GROUP_ACTION.GROUP_VIEW,GROUP_ACTION.MEMBER_VIEW,GROUP_ACTION.OFFICER_VIEW,GROUP_ACTION.CONSTITUTION_VIEW,GROUP_ACTION.CYCLE_VIEW,GROUP_ACTION.MEETING_VIEW,GROUP_ACTION.ATTENDANCE_VIEW,GROUP_ACTION.FINANCIAL_VIEW,GROUP_ACTION.LOAN_VIEW,GROUP_ACTION.RECONCILIATION_VIEW,GROUP_ACTION.SHAREOUT_VIEW,GROUP_ACTION.REPORT_VIEW,GROUP_ACTION.REPORT_EXPORT]);
const CHAIR_OPERATIONS=new Set([GROUP_ACTION.CYCLE_PARTICIPATION_MANAGE,GROUP_ACTION.MEETING_OPERATE,GROUP_ACTION.ATTENDANCE_OPERATE,GROUP_ACTION.FINANCIAL_OPERATE,GROUP_ACTION.FINANCIAL_REVERSE,GROUP_ACTION.LOAN_REPAY,GROUP_ACTION.RECONCILIATION_OPERATE,GROUP_ACTION.CYCLE_MANAGE]);
const RECORD_KEEPER_OPERATIONS=new Set([GROUP_ACTION.MEETING_OPERATE,GROUP_ACTION.ATTENDANCE_OPERATE,GROUP_ACTION.FINANCIAL_OPERATE,GROUP_ACTION.FINANCIAL_REVERSE,GROUP_ACTION.LOAN_REQUEST,GROUP_ACTION.LOAN_DISBURSE,GROUP_ACTION.LOAN_OPERATE,GROUP_ACTION.LOAN_REPAY,GROUP_ACTION.RECONCILIATION_OPERATE]);
const SHAREOUT_ACTIONS=new Set([GROUP_ACTION.SHAREOUT_PREPARE,GROUP_ACTION.SHAREOUT_APPROVE,GROUP_ACTION.SHAREOUT_PAYOUT,GROUP_ACTION.SHAREOUT_COMPLETE,GROUP_ACTION.SHAREOUT_OPERATE]);
const PROGRAM_ASSISTED_FACILITATOR_ACTIONS=new Set([...VIEW_ACTIONS,GROUP_ACTION.CYCLE_PARTICIPATION_MANAGE,GROUP_ACTION.GROUP_MANAGE,GROUP_ACTION.MEMBER_MANAGE,GROUP_ACTION.OFFICER_MANAGE,GROUP_ACTION.CONSTITUTION_MANAGE,GROUP_ACTION.CYCLE_MANAGE,GROUP_ACTION.CYCLE_CLOSE,GROUP_ACTION.MEETING_OPERATE,GROUP_ACTION.ATTENDANCE_OPERATE,GROUP_ACTION.FINANCIAL_OPERATE,GROUP_ACTION.FINANCIAL_REVERSE,GROUP_ACTION.LOAN_REQUEST,GROUP_ACTION.LOAN_DISBURSE,GROUP_ACTION.LOAN_OPERATE,GROUP_ACTION.LOAN_REPAY,GROUP_ACTION.RECONCILIATION_OPERATE,...SHAREOUT_ACTIONS,GROUP_ACTION.DIGITAL_ACCESS_MANAGE]);

export function canGroupAction(user,ctx,action){
  if(ctx.operation_mode==='MEMBER_MANAGED'&&repo.isCurrentDigitalOfficer(ctx)){
    if(ctx.isChairperson&&['ACTIVE','CLOSING'].includes(ctx.cycle_status)&&SHAREOUT_ACTIONS.has(action))return true;
    if(ctx.isChairperson&&ctx.cycle_status==='CLOSING'&&action===GROUP_ACTION.CYCLE_CLOSE)return true;
    if(ctx.isRecordKeeper&&ctx.cycle_status==='CLOSING'&&action===GROUP_ACTION.SHAREOUT_PAYOUT)return true;
  }
  if(action===GROUP_ACTION.LOAN_DECIDE)return Boolean(repo.isCurrentDigitalOfficer(ctx)&&ctx.isChairperson);
  if(action===GROUP_ACTION.LOAN_REQUEST||action===GROUP_ACTION.LOAN_DISBURSE){
    if(ctx.operation_mode==='MEMBER_MANAGED')return Boolean(repo.isCurrentDigitalOfficer(ctx)&&ctx.isRecordKeeper);
    if(ctx.operation_mode!=='PROGRAM_ASSISTED')return false;
  }
  if(ctx.has_program_scope||user.roles?.includes('SUPER_ADMIN'))return true;
  const facilitator=Boolean(user.roles?.includes('FACILITATOR')&&ctx.is_assigned_facilitator&&ctx.is_active_facilitator&&ctx.has_facilitator_scope);
  if(facilitator)return ctx.operation_mode==='PROGRAM_ASSISTED'
    ?PROGRAM_ASSISTED_FACILITATOR_ACTIONS.has(action)
    :VIEW_ACTIONS.has(action)||action===GROUP_ACTION.DIGITAL_ACCESS_MANAGE;
  if(!repo.isCurrentDigitalOfficer(ctx))return false;
  if(ctx.cycle_status==='CLOSED'){
    if([GROUP_ACTION.REPORT_VIEW,GROUP_ACTION.REPORT_EXPORT].includes(action))return ctx.operation_mode==='MEMBER_MANAGED'&&(ctx.isChairperson||ctx.isRecordKeeper);
    return ctx.operation_mode==='MEMBER_MANAGED'&&ctx.isChairperson&&[GROUP_ACTION.CYCLE_VIEW,GROUP_ACTION.SHAREOUT_VIEW,GROUP_ACTION.CYCLE_MANAGE].includes(action);
  }
  if(VIEW_ACTIONS.has(action))return true;
  if(ctx.isChairperson){
    if(CHAIR_OPERATIONS.has(action))return true;
    return ctx.operation_mode==='MEMBER_MANAGED'&&(action===GROUP_ACTION.CONSTITUTION_MANAGE||action===GROUP_ACTION.CYCLE_CLOSE);
  }
  return ctx.isRecordKeeper&&ctx.operation_mode==='MEMBER_MANAGED'&&RECORD_KEEPER_OPERATIONS.has(action);
}

export async function getGroupActorContext(user,groupId,client=pool,{lock=false}={}){
  const row=await repo.actorContext(client,user,groupId,lock);
  if(!row)throw new NotFoundError('Group not found');
  return {...row,isRecordKeeper:row.officer_position==='RECORD_KEEPER',isChairperson:row.officer_position==='CHAIRPERSON',isCommitteeMember:Boolean(row.officer_position),isActiveMember:row.member_status==='ACTIVE'};
}

export async function assertGroupAction(user,groupId,action,client=pool){
  const ctx=await getGroupActorContext(user,groupId,client);
  if(!canGroupAction(user,ctx,action))throw new AuthorizationError('GROUP_ACTION_DENIED');
  return ctx;
}

export async function requireGroupRouteAction(user,groupId,permission,action=GROUP_ACTION.VIEW,client=pool){
  const ctx=await getGroupActorContext(user,groupId,client);
  if(!canGroupAction(user,ctx,action))throw new AuthorizationError('GROUP_ACTION_DENIED');
  if(!repo.isCurrentDigitalOfficer(ctx))requirePermission(user,permission);
  return ctx;
}

export async function assertGroupFinancialOperator(user,groupId,client=pool){return assertGroupAction(user,groupId,GROUP_ACTION.FINANCIAL_OPERATE,client)}
export async function assertGroupMeetingOperator(user,groupId,client=pool){return assertGroupAction(user,groupId,GROUP_ACTION.MEETING_OPERATE,client)}
export async function canViewGroup(user,groupId,client=pool){return assertGroupAction(user,groupId,GROUP_ACTION.GROUP_VIEW,client)}
export async function getGroupCapabilities(user,groupId,client=pool){const ctx=await getGroupActorContext(user,groupId,client);return{ctx,capabilities:Object.fromEntries(Object.entries(GROUP_ACTION).filter(([key])=>key!=='VIEW').map(([key,action])=>[key,canGroupAction(user,ctx,action)]))}}
export async function getMyGroups(user,client=pool){return repo.linkedGroups(client,user)}

export async function assertProgramAssistedSetupAccess(user,groupId,client=pool){
  const ctx=await getGroupActorContext(user,groupId,client,{lock:true});
  if(ctx.has_program_scope||user.roles?.includes('SUPER_ADMIN'))return ctx;
  if(!user.roles?.includes('FACILITATOR')||!ctx.is_assigned_facilitator||!ctx.is_active_facilitator||!ctx.has_facilitator_scope)throw new AuthorizationError('AGENT_SETUP_SCOPE_DENIED');
  if(ctx.operation_mode!=='PROGRAM_ASSISTED')throw new AuthorizationError('AGENT_SETUP_ENDED_AFTER_HANDOVER');
  return ctx;
}

export function assertMemberManagedActor(ctx){
  if(ctx.operation_mode!=='MEMBER_MANAGED')throw new ConflictError('Group is not member-managed');
}
