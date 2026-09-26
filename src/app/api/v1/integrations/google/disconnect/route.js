import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { disconnectGoogleAccount } from "@/modules/google-integration/google-connection.service";
import { ok, fail } from "@/lib/errors/response";

export async function POST() {
  try {
    const user = await requireAuth();
    requirePermission(user, "organization.manage");
    return ok(await disconnectGoogleAccount(user));
  } catch (error) {
    return fail(error);
  }
}
