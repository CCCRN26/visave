import{z}from'zod';
export const addCycleParticipantSchema=z.object({memberId:z.string().uuid(),participationStartDate:z.string().date()});
export const addMeetingParticipantSchema=z.object({memberId:z.string().uuid()});
