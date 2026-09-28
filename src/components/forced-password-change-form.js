"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ForcedPasswordChangeForm({ destination }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: form.get("newPassword"), confirmPassword: form.get("confirmPassword") }),
      });
      const json = response.headers.get("content-type")?.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      if (!response.ok) return setError(json?.error?.message || "Your password could not be saved. Please try again.");
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Your password could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return <form className="login-card" onSubmit={submit}>
    <p className="eyebrow">First login security</p>
    <h2>Create a new password</h2>
    <p className="muted">For your security, please change the temporary password you were given before continuing.</p>
    <label>New password<input name="newPassword" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label>
    <p className="form-help">Use at least 12 characters.</p>
    <label>Confirm new password<input name="confirmPassword" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button disabled={busy}>{busy ? "Saving…" : "Save New Password"}</button>
    <button className="secondary-button" type="button" disabled={busy} onClick={logout}>Log Out</button>
  </form>;
}
