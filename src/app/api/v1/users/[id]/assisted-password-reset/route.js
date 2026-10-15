import { requireAuth } from "@/lib/auth/session";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { assistedPasswordResetSchema } from "@/modules/auth/assisted-password-reset.schemas";
import { assistedPasswordResetWithTurnstile } from "@/modules/auth/assisted-password-reset.service";

export async function POST(request, { params }) {
  try {
    const actor = await requireAuth();
    const { id } = await params;
    const data = parse(assistedPasswordResetSchema, await request.json());
    const response = ok(await assistedPasswordResetWithTurnstile(actor, id, data));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return fail(error);
  }
}
