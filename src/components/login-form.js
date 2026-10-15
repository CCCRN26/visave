"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedHome } from "@/lib/auth/destination";
import TurnstileWidget from "@/components/turnstile-widget";

export default function LoginForm({ turnstile }) {
  const router = useRouter();
  const widgetRef = useRef(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function resetVerification() { setTurnstileToken(""); widgetRef.current?.reset(); }
  function handleTokenChange(token) {
    setTurnstileToken(token);
    if (token) setTurnstileError("");
  }
  async function submit(event) {
    event.preventDefault();
    if (turnstile.enabled && !turnstileToken) return;
    setBusy(true); setError(""); setTurnstileError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), turnstileToken }),
      });
      const json = await response.json();
      if (!response.ok) {
        resetVerification();
        const message = json.error?.message || "Login failed";
        if (json.error?.code?.startsWith("TURNSTILE_")) setTurnstileError(message);
        else setError(message);
        return;
      }
      if (json.data?.user?.must_change_password) { router.replace("/change-password"); router.refresh(); return; }
      const meResponse = await fetch("/api/v1/auth/me");
      if (!meResponse.ok) throw new Error("Unable to load authenticated account");
      const me = await meResponse.json();
      router.replace(authenticatedHome(me.data?.user)); router.refresh();
    } catch { resetVerification(); setError("Login failed. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <Link className="public-brand" href="/" aria-label="Visave home"><span className="public-logo-container"><Image className="public-full-logo" src="/visave-logo.png" alt="Visave" width={1427} height={505} priority style={{ width: "clamp(150px,18vw,210px)", height: "auto" }} /></span></Link>
        <div><p className="section-kicker">Community finance, made clearer</p><h1>Community savings.<br />Stronger livelihoods.<br />Better health.</h1><p>Secure tools for programme teams, Agents and elected group leaders.</p></div><small>Visave is a CCCRN programme.</small>
      </section>
      <section className="login-form-side">
        <form className="login-card" onSubmit={submit}>
          <p className="eyebrow">Secure platform access</p><h2>Welcome back</h2><p className="muted">Sign in to continue to your workspace.</p>
          <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.org" /></label>
          <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          <TurnstileWidget ref={widgetRef} {...turnstile} action="login" onTokenChange={handleTokenChange} />
          {turnstileError && <p className="form-error" role="alert">{turnstileError}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button disabled={busy || (turnstile.enabled && !turnstileToken)}>{busy ? "Signing in…" : "Sign in"}</button>
          <div className="login-links"><Link href="/">Back to website</Link><Link href="/find-a-group">Find a Group</Link></div>
        </form>
      </section>
    </main>
  );
}

