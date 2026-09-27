import { OFFICER_POSITIONS } from "./constants.js";
import { formatDateForInput } from "../../lib/utils/date.js";

export function isOfficerCycleEditable(status) {
  return ["DRAFT", "READY"].includes(status);
}

export function normalizeOfficerCycleDates(cycle) {
  if (!cycle) return cycle;
  return {
    ...cycle,
    start_date: formatDateForInput(cycle.start_date),
    expected_end_date: formatDateForInput(cycle.expected_end_date),
  };
}

export function getOfficerAssignmentOptions(participants, assignments) {
  const activeAssignments = assignments.filter((assignment) => assignment.status === "ACTIVE");
  const assignedMemberIds = new Set(activeAssignments.map((assignment) => assignment.member_id));
  const occupiedPositions = new Set(activeAssignments.map((assignment) => assignment.position_code));

  return {
    eligibleParticipants: participants.filter(
      (participant) => participant.member_status === "ACTIVE" && !assignedMemberIds.has(participant.member_id),
    ),
    availablePositions: OFFICER_POSITIONS.filter((position) => !occupiedPositions.has(position)),
  };
}
