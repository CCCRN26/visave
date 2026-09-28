import { requireSessionUser } from "@/lib/auth/session";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { forcedPasswordChangeSchema } from "@/modules/auth/auth.schemas";
import { changeForcedPassword } from "@/modules/auth/password-change.service";

export async function POST(request) {
  try {
    const user = await requireSessionUser();
    const data = parse(forcedPasswordChangeSchema, await request.json());
    return ok(await changeForcedPassword(data, user));
  } catch (error) {
    return fail(error);
  }
}
