import {z} from "zod";
import {PASSWORD_MAX_LENGTH,PASSWORD_MIN_LENGTH} from "./password-policy.js";
export const loginSchema=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(8).max(128),turnstileToken:z.string().optional()});
export const forcedPasswordChangeSchema=z.object({
  newPassword:z.string().min(PASSWORD_MIN_LENGTH,"Password must be at least 12 characters").max(PASSWORD_MAX_LENGTH,"Password must be no more than 128 characters"),
  confirmPassword:z.string(),
}).strict().refine(value=>value.newPassword===value.confirmPassword,{path:["confirmPassword"],message:"Passwords do not match"});
