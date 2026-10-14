"use client";

import { useEffect, useRef, useState } from "react";

const ERROR_MESSAGES = {
  SELF_ASSISTED_RESET_NOT_ALLOWED: "Use the normal change-password screen to change your own password.",
  ASSISTED_RESET_TARGET_INELIGIBLE: "This account is not eligible for an assisted password reset.",
  FORBIDDEN: "You are not authorized to reset this account.",
};

export default function AssistedPasswordReset({ targetUserId, displayName, login }) {
  const dialogRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  function closeDialog() {
    if (busy) return;
    setOpen(false);
    setError("");
    setTemporaryPassword("");
    setCopied(false);
  }

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/users/${targetUserId}/assisted-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: form.get("reason"), confirmed: form.get("confirmed") === "on" }),
      });
      const json = response.headers.get("content-type")?.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      if (!response.ok) {
        setError(ERROR_MESSAGES[json?.error?.code] || json?.error?.message || "Unable to reset the password. Please try again.");
        return;
      }
      setTemporaryPassword(json.data.temporaryPassword);
    } catch {
      setError("Unable to reset the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Copy failed. Select and copy the temporary password manually.");
    }
  }

  return (
    <>
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>Reset Password</button>
      <dialog ref={dialogRef} className="digital-access-dialog" onCancel={closeDialog}>
        {temporaryPassword ? (
          <div className="digital-access-form">
            <div>
              <p className="eyebrow">Password reset successful</p>
              <h2>Temporary password</h2>
              <p><strong>{displayName}</strong><br /><span className="muted">{login}</span></p>
            </div>
            <div className="temporary-password-result" aria-live="polite">
              <code>{temporaryPassword}</code>
              <button type="button" className="secondary-button" onClick={copyPassword}>{copied ? "Copied" : "Copy Password"}</button>
            </div>
            <p>Share this temporary password securely with the user. The user will be required to create a new password at their next login.</p>
            <p className="form-help"><strong>This password will only be shown once.</strong> It cannot be recovered after this dialog is closed.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions"><button type="button" onClick={closeDialog}>Done</button></div>
          </div>
        ) : (
          <form className="digital-access-form" onSubmit={submit}>
            <div>
              <p className="eyebrow">Assisted password reset</p>
              <h2>Reset Password</h2>
              <p><strong>{displayName}</strong><br /><span className="muted">{login}</span></p>
            </div>
            <p>This generates a new temporary password and signs the user out of all active sessions. Their existing password will stop working, and they must create a permanent password at their next login.</p>
            <label>
              Reason for reset
              <textarea name="reason" required maxLength="500" rows="4" disabled={busy} />
            </label>
            <label className="confirmation-check">
              <input name="confirmed" type="checkbox" required disabled={busy} />
              I confirm that I am authorized to reset this user&apos;s password and will share it through a trusted channel.
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Cancel</button>
              <button type="submit" className="danger-button" disabled={busy}>{busy ? "Resetting…" : "Confirm Reset Password"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

