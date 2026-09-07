"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ArchiveGroupAction({ groupId, groupName }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const router = useRouter();
  async function archive() {
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/groups/${groupId}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, confirmation }) });
    const json = await response.json(); setBusy(false);
    if (!response.ok) return setError(json.error?.message || "Unable to archive this group");
    setOpen(false); router.refresh();
  }
  return <><button type="button" className="danger-button" onClick={() => setOpen(true)}>Archive Group</button>{open && <div className="modal-backdrop" role="presentation"><section className="panel archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-title"><h2 id="archive-title">Archive {groupName}?</h2><p>Archiving removes this group from active operations but permanently preserves its financial and audit history.</p><label>Reason for archive *<textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><label>Type ARCHIVE to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button type="button" className="danger-button" disabled={busy || reason.trim().length < 5 || confirmation !== "ARCHIVE"} onClick={archive}>{busy ? "Archiving…" : "Archive Group"}</button></div></section></div>}</>;
}
