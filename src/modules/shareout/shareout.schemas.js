import { z } from "zod";

const idempotencyKey = z.string().trim().min(8).max(160);
export const prepareShareoutSchema = z.object({}).strict();
export const approveShareoutSchema = z.object({ idempotencyKey }).strict();
export const payoutSchema = z.object({ entitlementId: z.string().uuid(), idempotencyKey }).strict();
export const payoutReversalSchema = z.object({ idempotencyKey }).strict();
export const carryForwardSchema = z.object({ targetCycleId: z.string().uuid(), idempotencyKey }).strict();
export const closeCycleSchema = z.object({}).strict();
