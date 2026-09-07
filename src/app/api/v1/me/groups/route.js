import{requireAuth}from'@/lib/auth/session';import{getMyGroups}from'@/modules/group-access/group-access.service';import{ok,fail}from'@/lib/errors/response';
export async function GET(){try{const u=await requireAuth();return ok(await getMyGroups(u))}catch(e){return fail(e)}}
