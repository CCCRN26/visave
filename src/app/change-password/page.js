import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { authenticatedHome } from "@/lib/auth/destination";
import ForcedPasswordChangeForm from "@/components/forced-password-change-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.must_change_password) redirect(authenticatedHome(user));
  return <main className="login-page">
    <section className="login-story">
      <div><p className="section-kicker">Secure your account</p><h1>One quick step before you continue.</h1><p>Create a password that only you know. Your temporary password will stop working immediately.</p></div>
      <small>Visave is a CCCRN programme.</small>
    </section>
    <section className="login-form-side"><ForcedPasswordChangeForm destination={authenticatedHome(user)}/></section>
  </main>;
}
