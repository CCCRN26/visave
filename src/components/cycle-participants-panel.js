"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readActionResponse } from "@/lib/client/safe-response";
import { formatDate } from "@/lib/utils/date";
export default function CycleParticipantsPanel({
  groupId,
  cycle,
  previousParticipants = [],
  currentParticipants = [],
  eligibleMembers = [],
  canManage = true,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const router = useRouter(),
    lock = useRef(false),
    current = new Set(currentParticipants.map((x) => x.member_id)),
    [selected, setSelected] = useState(
      () =>
        new Set(current.size ? current : previousParticipants.map((x) => x.id)),
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [showNew, setShowNew] = useState(false),
    [showExisting, setShowExisting] = useState(false);
  const request = async (path, { method = "POST", body } = {}) => {
    const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
      result = await readActionResponse(response);
    if (!response.ok)
      throw new Error(
        result.error?.message || "We could not save this change.",
      );
    return result.data;
  };
  async function confirm() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      for (const member of previousParticipants) {
        if (selected.has(member.id) && !current.has(member.id))
          await request(
            `/api/v1/groups/${groupId}/cycles/${cycle.id}/participants`,
            {
              body: {
                memberId: member.id,
                participationStartDate: cycle.start_date,
              },
            },
          );
        if (!selected.has(member.id) && current.has(member.id))
          await request(
            `/api/v1/groups/${groupId}/cycles/${cycle.id}/participants/${member.id}`,
            { method: "DELETE" },
          );
      }
      setMessage(`Cycle ${cycle.cycle_number} members confirmed.`);
      router.refresh();
    } catch (e) {
      setMessage(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function addExisting(e) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const memberId = new FormData(e.currentTarget).get("memberId");
      await request(
        `/api/v1/groups/${groupId}/cycles/${cycle.id}/participants`,
        { body: { memberId, participationStartDate: cycle.start_date } },
      );
      setShowExisting(false);
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function addNew(e) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await request(`/api/v1/groups/${groupId}/members`, {
        body: {
          ...data,
          joinCurrentCycle: true,
          cycleId: cycle.id,
          participationStartDate: cycle.start_date,
          status: "ACTIVE",
        },
      });
      setShowNew(false);
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="cycle-participants-panel">
      <p>
        Select the members who want to participate in Cycle {cycle.cycle_number}
        .
      </p>
      <p>
        <strong>
          Previous cycle participants: {previousParticipants.length}
        </strong>{" "}
        · Selected for Cycle {cycle.cycle_number}: {selected.size}
      </p>
      {message && <p role="alert">{message}</p>}
      <div className="participant-checklist">
        {previousParticipants.map((member) => (
          <label key={member.id}>
            <input
              type="checkbox"
              disabled={!canManage || busy}
              checked={selected.has(member.id)}
              onChange={() =>
                setSelected((value) => {
                  const next = new Set(value);
                  next.has(member.id)
                    ? next.delete(member.id)
                    : next.add(member.id);
                  return next;
                })
              }
            />
            <span>
              <strong>
                {member.first_name} {member.last_name}
              </strong>
              <small>
                {selected.has(member.id)
                  ? "Continuing"
                  : "Not continuing this cycle"}
              </small>
            </span>
          </label>
        ))}
      </div>
      {canManage && (
        <>
          <button disabled={busy} onClick={confirm}>
            {busy ? "Saving…" : `Confirm Cycle ${cycle.cycle_number} Members`}
          </button>{" "}
          <button
            className="secondary"
            type="button"
            onClick={() => setShowNew(!showNew)}
          >
            + Add New Member
          </button>{" "}
          <button
            className="secondary"
            type="button"
            onClick={() => setShowExisting(!showExisting)}
          >
            + Add Existing Group Member
          </button>
        </>
      )}
      {showExisting && (
        <form className="panel grid" onSubmit={addExisting}>
          <label>
            Existing member
            <select name="memberId" required>
              <option value="">Select member</option>
              {eligibleMembers.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.member_code} · {m.first_name} {m.last_name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Add existing member</button>
        </form>
      )}
      {showNew && (
        <form className="panel grid" onSubmit={addNew}>
          <h3>Add new member to Cycle {cycle.cycle_number}</h3>
          <label>
            First name
            <input name="firstName" required />
          </label>
          <label>
            Middle name
            <input name="middleName" />
          </label>
          <label>
            Last name
            <input name="lastName" required />
          </label>
          <label>
            Sex
            <select name="sex">
              <option value="UNDISCLOSED">Prefer not to say</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Date joined
            <input
              name="dateJoined"
              type="date"
              max={today}
              defaultValue={today}
              required
            />
          </label>
          <p>
            This member will participate from {formatDate(cycle.start_date)}.
            They will not be included in meetings or obligations before this
            date.
          </p>
          <button disabled={busy}>
            Add Member to Cycle {cycle.cycle_number}
          </button>
        </form>
      )}
    </div>
  );
}
