import { z } from "zod";

export const googleMeetIdentitySchema = z.object({
  googleMeetEmail: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().toLowerCase().email().max(254).nullable(),
  ),
}).strict();
