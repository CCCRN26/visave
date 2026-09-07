"use client";

import { useState } from "react";
import { formatDate } from "@/lib/utils/date";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function CycleScheduleForm({
  constitutions,
  busy = false,
  onSubmit,
  cycleNumber = 1,
  fixedCycleNumber = false,
  showInternalFields = true,
  initialStartDate = "",
  submitLabel = "Save cycle",
}) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState("");
  const [shareoutDate, setShareoutDate] = useState("");
  const approved = constitutions.filter((item) => item.status === "APPROVED");
  const defaultConstitution = approved[0]?.id || "";
  const showMetadata = showInternalFields && submitLabel === "Save cycle";
  const endBeforeStart = Boolean(startDate && endDate && endDate <= startDate);
  const shareoutBeforeStart = Boolean(shareoutDate && startDate && shareoutDate < startDate);
  const shareoutAfterEnd = Boolean(shareoutDate && endDate && shareoutDate > endDate);
  const dateError = endBeforeStart
    ? "Expected end date must be after the cycle start date."
    : shareoutBeforeStart
      ? `Expected Share-out date must be on or after ${formatDate(startDate)}.`
      : shareoutAfterEnd
        ? `Expected Share-out date must be on or before ${formatDate(endDate)}.`
        : "";

  return (
    <form
      className="grid"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <label>
        Approved constitution
        <select name="constitutionId" defaultValue={defaultConstitution} required>
          <option value="">Select approved version</option>
          {approved.map((item) => (
            <option key={item.id} value={item.id}>Version {item.version_number}</option>
          ))}
        </select>
      </label>
      {showMetadata && <label>
        Cycle number
        <input name="cycleNumber" type="number" value={fixedCycleNumber ? cycleNumber : undefined} defaultValue={fixedCycleNumber ? undefined : cycleNumber} min="1" readOnly={fixedCycleNumber} />
      </label>}
      {!showMetadata && <input type="hidden" name="cycleNumber" value={cycleNumber} />}
      <label>Start date<input name="startDate" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
      <label>Expected end date<input name="expectedEndDate" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} required /></label>
      <label>Expected share-out date<input name="expectedShareoutDate" type="date" value={shareoutDate} min={startDate || undefined} max={endDate || undefined} aria-describedby={dateError ? "cycle-date-error" : undefined} onChange={(event) => setShareoutDate(event.target.value)} /></label>
      {dateError && <p id="cycle-date-error" role="alert">{dateError}</p>}
      <label>
        Meeting day
        <select name="meetingDayOfWeek">
          <option value="">Select day</option>
          {days.map((day, index) => <option value={index + 1} key={day}>{day}</option>)}
        </select>
      </label>
      {showMetadata && <label>Status<input value="READY" readOnly /></label>}
      <input type="hidden" name="status" value="READY" />
      <button disabled={busy || approved.length === 0 || Boolean(dateError)}>{submitLabel}</button>
    </form>
  );
}
