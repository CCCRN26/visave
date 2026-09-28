import {z} from "zod";
export const loginSchema=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(8).max(128)});
export const forcedPasswordChangeSchema=z.object({
  newPassword:z.string().min(12,"Password must be at least 12 characters").max(128,"Password must be no more than 128 characters"),
  confirmPassword:z.string(),
}).strict().refine(value=>value.newPassword===value.confirmPassword,{path:["confirmPassword"],message:"Passwords do not match"});
