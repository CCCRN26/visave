import {requireAuth} from "@/lib/auth/session";import {ok,fail} from "@/lib/errors/response";export async function GET(){try{return ok({user:await requireAuth()});}catch(e){return fail(e);}}
