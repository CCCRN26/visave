import { z } from "zod";

export const assistedPasswordResetSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500, "Reason must be no more than 500 characters"),
  confirmed: z.literal(true, { error: "Explicit confirmation is required" }),
  turnstileToken: z.string().optional(),
}).strict();

