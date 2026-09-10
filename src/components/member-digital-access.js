"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { phoneInputProps, sanitizePhoneInput } from "@/lib/validation/phone";

const ERROR_MESSAGES = {
  USER_EMAIL_ALREADY_EXISTS: "An account with this email already exists.",
  MEMBER_ALREADY_LINKED: "This member already has digital access.",
  USER_ALREADY_LINKED: "That account is already linked to a member in this group.",
  INVALID_MEMBER_USER_LINK: "The selected account cannot be linked to this member.",
  DIGITAL_ACCESS_REQUIRES_ACTIVE_MEMBER: "Digital access can only be enabled for an active member.",
  FORBIDDEN: "You are not authorized to manage digital access for this group.",
};

export default function MemberDigitalAccess({ groupId, member, officerLabel, canManage }) {
  const router = useRouter();
  const dialogRef = useRef(null);
  const [dialog, setDialog] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isLeader = ["CHAIRPERSON", "RECORD_KEEPER"].includes(member.position_code);

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) element.showModal();
    if (!dialog && element?.open) element.close();
  }, [dialog]);

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setError("");
    setShowPassword(false);
  }

  function messageFor(json) {
    return ERROR_MESSAGES[json.error?.code] || json.error?.message || "Unable to update digital access.";
  }

  async function responseBody(response) {
    if (!response.headers.get("content-type")?.includes("application/json")) return null;
    return response.json().catch(() => null);
  }

  async function createLogin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/members/${member.id}/digital-access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "CREATE_USER",
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          email: form.get("email"),
          phone: form.get("phone") || undefined,
          password: form.get("password"),
        }),
      });
      const json = await responseBody(response);
      if (!response.ok) {
        setError(json ? messageFor(json) : "Unable to create login. Please try again.");
        return;
      }
      setDialog(null);
      setShowPassword(false);
      router.refresh();
    } catch {
      setError("Unable to create login. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disableAccess() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/members/${member.id}/digital-access`, { method: "DELETE" });
      const json = await responseBody(response);
      if (!response.ok) {
        setError(json ? messageFor(json) : "Unable to disable digital access. Please try again.");
        return;
      }
      setDialog(null);
      router.refresh();
    } catch {
      setError("Unable to disable digital access. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel digital-access-panel" aria-labelledby="digital-access-title">
      <div className="digital-access-heading">
        <div>
          <p className="eyebrow">Member identity</p>
          <h2 id="digital-access-title">Digital Access</h2>
        </div>
        <span className={`access-status ${member.linked_user_id ? "enabled" : "disabled"}`}>
          {member.linked_user_id ? "✓ Access enabled" : "Not enabled"}
        </span>
      </div>

      <div className="digital-access-details">
        <div><span>Officer role</span><strong>{officerLabel || "Not an officer"}</strong></div>
        {member.linked_user_id && <div><span>Linked account</span><strong>{member.linked_user_email}</strong></div>}
        {member.linked_user_id && <div><span>Account status</span><strong>{member.linked_user_status || "—"}</strong></div>}
      </div>

      {!member.linked_user_id && isLeader && (
        <p className="digital-access-guidance">
          The {officerLabel} requires digital access before the group can transition to member-managed operation.
        </p>
      )}
      {!member.linked_user_id && !isLeader && (
        <p className="digital-access-guidance">Digital access is not currently enabled for this member.</p>
      )}

      {canManage && !member.linked_user_id && (
        <button type="button" onClick={() => setDialog("create")}>Enable Digital Access</button>
      )}
      {canManage && member.linked_user_id && (
        <button type="button" className="danger-button" onClick={() => setDialog("disable")}>Disable Digital Access</button>
      )}

      <dialog ref={dialogRef} className="digital-access-dialog" onCancel={closeDialog}>
        {dialog === "create" && (
          <form onSubmit={createLogin} className="digital-access-form">
            <div>
              <p className="eyebrow">Create member login</p>
              <h2>Enable Digital Access</h2>
              <p className="muted"><strong>{member.first_name} {member.middle_name || ""} {member.last_name}</strong><br />{officerLabel || "Group member"}</p>
            </div>
            <label>First Name<input name="firstName" required maxLength="100" defaultValue={member.first_name} autoComplete="given-name" /></label>
            <label>Last Name<input name="lastName" required maxLength="100" defaultValue={member.last_name} autoComplete="family-name" /></label>
            <label>Email<input name="email" required type="email" autoComplete="email" /></label>
            <label>Phone<input name="phone" {...phoneInputProps} defaultValue={member.phone || ""} autoComplete="tel" onInput={(event) => { event.currentTarget.value = sanitizePhoneInput(event.currentTarget.value); }} /></label>
            <label>
              Temporary Password
              <span className="password-field">
                <input name="password" required minLength="12" maxLength="128" type={showPassword ? "text" : "password"} autoComplete="new-password" aria-describedby="temporary-password-help" />
                <button type="button" className="secondary-button" aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? "Hide" : "Show"}</button>
              </span>
            </label>
            <p id="temporary-password-help" className="form-help">Password must contain at least 12 characters. The user will be required to change it after signing in.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Cancel</button>
              <button disabled={busy}>{busy ? "Creating Login…" : "Create Login"}</button>
            </div>
          </form>
        )}
        {dialog === "disable" && (
          <div className="digital-access-form">
            <div>
              <p className="eyebrow">Remove member link</p>
              <h2>Disable Digital Access?</h2>
              <p>This removes the login link from <strong>{member.first_name} {member.last_name}</strong>. It does not delete the user account.</p>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Cancel</button>
              <button type="button" className="danger-button" disabled={busy} onClick={disableAccess}>{busy ? "Disabling…" : "Disable Digital Access"}</button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
