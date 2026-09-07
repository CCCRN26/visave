import { ValidationError } from "@/lib/errors";
export function parse(schema, value) { const result=schema.safeParse(value); if(!result.success) throw new ValidationError("Invalid request", result.error.flatten()); return result.data; }
