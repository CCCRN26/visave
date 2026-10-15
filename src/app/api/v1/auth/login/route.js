import { NextResponse } from "next/server";
import { parse } from "@/lib/validation/parse";
import { loginSchema } from "@/modules/auth/auth.schemas";
import { login } from "@/modules/auth/auth.service";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth/session";
import { checkLoginLimit } from "@/lib/auth/rate-limit";
import { fail } from "@/lib/errors/response";

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    checkLoginLimit(ip || "unknown");
    const data = parse(loginSchema, await request.json());
    const result = await login({ email: data.email, password: data.password, turnstileToken: data.turnstileToken, ip, userAgent: request.headers.get("user-agent") });
    const response = NextResponse.json({ success: true, data: { user: result.user } });
    response.cookies.set(SESSION_COOKIE, result.token, cookieOptions(result.expiresAt));
    return response;
  } catch (error) {
    return fail(error);
  }
}
