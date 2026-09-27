"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readActionResponse } from "@/lib/client/safe-response";
import { OFFICER_POSITIONS, POSITION_LABELS } from "@/modules/onboarding/constants";
import { getOfficerAssignmentOptions, isOfficerCycleEditable } from "@/modules/onboarding/officer-assignment-options";
import { formatDateForInput } from "@/lib/utils/date";

export default function OfficerAssignmentPanel({ groupId, cycle, participants, assignments, canManage, onChanged }) {
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmingId, setConfirmingId] = useState(null);
  const { eligibleParticipants, availablePositions } = getOfficerAssignmentOptions(participants, assignments);
  const formKey = assignments.map((assignment) => assignment.id).sort().join(":");
  const assignmentsByPosition = new Map(assignments.map((assignment) => [assignment.position_code, assignment]));
  const editable = isOfficerCycleEditable(cycle.status);
  const canEdit = canManage && editable;
  const appointmentMin = formatDateForInput(cycle.start_date);
  const appointmentMax = formatDateForInput(cycle.expected_end_date);

  async function refreshAssignments() {
    if (onChanged) await onChanged();
    else router.refresh();
  }

  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(`/api/v1/groups/${groupId}/officers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await readActionResponse(response);
      if (!response.ok) throw new Error(result.error?.message || "Officer assignment failed. Please try again.");
      await refreshAssignments();
    } catch (error) {
      setMessage(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function undo(assignment) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/officers/${assignment.id}`, { method: "DELETE" });
      const result = await readActionResponse(response);
      if (!response.ok) throw new Error(result.error?.message || "The officer assignment could not be undone. Please try again.");
      setConfirmingId(null);
      await refreshAssignments();
    } catch (error) {
      setMessage(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const noMembers = eligibleParticipants.length === 0;
  const noPositions = availablePositions.length === 0;

  return <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
    <h2>Assign Cycle {cycle.cycle_number} Officers</h2>
    <p>Only active, unassigned members participating in Cycle {cycle.cycle_number} can be selected. Earlier-cycle officer history is unchanged.</p>
    {message && <p role="alert">{message}</p>}
    {canEdit && noMembers && <p className="muted">All eligible members already have officer positions.</p>}
    {canEdit && noPositions && <p className="muted">All officer positions have been assigned.</p>}
    {canEdit && !noMembers && !noPositions && <form className="grid" key={formKey} onSubmit={submit}>
      <input type="hidden" name="cycleId" value={cycle.id}/>
      <label>Officer Position<select name="positionCode" required>{availablePositions.map((position) => <option value={position} key={position}>{POSITION_LABELS[position]}</option>)}</select></label>
      <label>Member<select name="memberId" required><option value="">Select member</option>{eligibleParticipants.map((member) => <option value={member.member_id} key={member.member_id}>{member.member_code} · {member.first_name} {member.last_name}</option>)}</select></label>
      <label>Appointed date<input name="appointedAt" type="date" min={appointmentMin} max={appointmentMax}/></label>
      <button disabled={busy}>{busy ? "Assigning…" : "Assign Officer"}</button>
    </form>}
    <h3>Assigned Officers</h3>
    <ul>{OFFICER_POSITIONS.map((position) => {
      const assignment = assignmentsByPosition.get(position);
      return <li key={position}>
      <strong>{POSITION_LABELS[position]}</strong>: {assignment ? assignment.member_name : <span className="muted">Not assigned</span>}{" "}
      {assignment && canEdit && confirmingId !== assignment.id && <button type="button" disabled={busy} onClick={() => setConfirmingId(assignment.id)}>Undo Assignment</button>}
      {assignment && canEdit && confirmingId === assignment.id && <div role="dialog" aria-label="Undo officer assignment">
        <p><strong>Undo this officer assignment?</strong></p>
        <p>This will remove {assignment.member_name} as {POSITION_LABELS[assignment.position_code]} for the current cycle. The assignment history will be kept.</p>
        <button type="button" disabled={busy} onClick={() => setConfirmingId(null)}>Cancel</button>{" "}
        <button type="button" disabled={busy} onClick={() => undo(assignment)}>{busy ? "Undoing…" : "Undo Assignment"}</button>
      </div>}
    </li>;
    })}</ul>
  </section>;
}
