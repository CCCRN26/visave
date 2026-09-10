import {z} from 'zod';
import {optionalPhoneSchema} from '@/lib/validation/phone';

export const digitalAccessSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('CREATE_USER'),firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(100),email:z.string().trim().toLowerCase().email(),phone:optionalPhoneSchema,password:z.string().min(12).max(128)}),
  z.object({mode:z.literal('LINK_EXISTING'),userId:z.string().uuid()})
]);
export const operationModeSchema=z.object({operationMode:z.enum(['PROGRAM_ASSISTED','MEMBER_MANAGED']),reason:z.string().trim().min(8).max(1000).optional()}).superRefine((v,ctx)=>{if(v.operationMode==='PROGRAM_ASSISTED'&&!v.reason)ctx.addIssue({code:'custom',path:['reason'],message:'A fallback reason is required'})});
