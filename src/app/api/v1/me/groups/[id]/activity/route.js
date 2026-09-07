import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/errors/response";
import { getMyGroupActivity } from "@/modules/member-self/member-self.service";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    return ok(await getMyGroupActivity(id,user,undefined,request.nextUrl.searchParams.get('cycleId')||null));
  } catch (error) {
    return fail(error);
  }
}
