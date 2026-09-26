import { pool } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { decryptGoogleRefreshToken } from "@/lib/security/google-token-encryption";
import { isGoogleMeetUrl, normalizeGoogleMeetUrl } from "@/modules/meetings/meeting-url";
import { getGoogleMeetAccessType } from "./google-config";
import { loadActiveGoogleConnection } from "./google-connection.service";
import { googleJsonRequest } from "./google-http";
import { refreshGoogleAccessToken } from "./google-oauth";

const CREATE_SPACE_URL = "https://meet.googleapis.com/v2/spaces";
const SPACE_NAME = /^spaces\/[^/\s]+$/;
const OPERATOR_EMAIL_MISSING_WARNING = "Google Meet was created. Add a Google Meet email to your profile to be assigned automatically as a co-host.";
const COHOST_ASSIGNMENT_FAILED_WARNING = "Google Meet was created, but the meeting operator could not be added as a co-host. The organizer can add a co-host manually.";
const COHOST_VERIFICATION_DELAYS_MS = [250, 500, 750];

export async function createGoogleMeetSpace(accessToken, options = {}) {
  const accessType = options.accessType || getGoogleMeetAccessType();
  if (!["TRUSTED", "RESTRICTED"].includes(accessType)) {
    throw new AppError("OPEN Google Meet access is not allowed.", "GOOGLE_MEET_ACCESS_TYPE_INVALID", 503);
  }
  const space = await googleJsonRequest(
    CREATE_SPACE_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ config: { accessType, entryPointAccess: "ALL" } }),
    },
    { fetchImpl: options.fetchImpl, accessType },
  );
  const meetingUri = normalizeGoogleMeetUrl(space.meetingUri);
  if (!meetingUri || !SPACE_NAME.test(space.name || "")) {
    throw new AppError("Google returned incomplete meeting details. Try again.", "GOOGLE_INVALID_RESPONSE", 502);
  }
  return { name: space.name, meetingUri, accessType };
}

export async function endGoogleMeetConference(meeting, user, options = {}) {
  if (!meeting.google_meet_space_name) return { attempted: false, ended: false };
  if (!SPACE_NAME.test(meeting.google_meet_space_name)) {
    throw new ValidationError("Google Meet space metadata is invalid.");
  }
  const db = options.pool || pool;
  const connection = await loadActiveGoogleConnection(db, user.organization_id);
  if (!connection) throw new AppError("Google Meet is not connected.", "GOOGLE_NOT_CONNECTED", 409);
  const accessToken = await refreshGoogleAccessToken(
    decryptGoogleRefreshToken(connection),
    { fetchImpl: options.fetchImpl },
  );
  await googleJsonRequest(
    `https://meet.googleapis.com/v2/${meeting.google_meet_space_name}:endActiveConference`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    },
    { fetchImpl: options.fetchImpl },
  );
  return { attempted: true, ended: true };
}

export async function createGoogleMeetCohost(accessToken, spaceName, email, options = {}) {
  if (!SPACE_NAME.test(spaceName || "")) {
    throw new ValidationError("Google Meet space metadata is invalid.");
  }
  const result = await googleJsonRequest(
    `https://meet.googleapis.com/v2/${spaceName}/members`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, role: "COHOST" }),
    },
    { fetchImpl: options.fetchImpl, acceptedStatuses: [409] },
  );
  const alreadyAssigned = result?.acceptedStatus === 409;
  const ready = await verifyGoogleMeetCohost(accessToken, spaceName, email, options);
  return { alreadyAssigned, ready };
}

export async function verifyGoogleMeetCohost(accessToken, spaceName, email, options = {}) {
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (const delay of COHOST_VERIFICATION_DELAYS_MS) {
    await wait(delay);
    try {
      const result = await googleJsonRequest(
        `https://meet.googleapis.com/v2/${spaceName}/members?pageSize=500&fields=members(email%2Crole)`,
        { headers: { authorization: `Bearer ${accessToken}` } },
        { fetchImpl: options.fetchImpl },
      );
      if ((result.members || []).some((member) =>
        member.role === "COHOST" && member.email?.toLowerCase() === email.toLowerCase())) {
        return true;
      }
    } catch (error) {
      console.error("Google Meet co-host readiness check failed", {
        spaceName,
        errorCategory: error?.code || "GOOGLE_UNKNOWN",
      });
    }
  }
  return false;
}

async function recordCohostAudit(client, meeting, user, outcome, errorCategory) {
  try {
    await writeAudit(client, {
      organizationId: user.organization_id,
      actorUserId: user.id,
      action: "GOOGLE_MEET_COHOST_ASSIGNMENT",
      entityType: "VSLA_MEETING",
      entityId: meeting.id,
      newValues: {
        operatorUserId: user.id,
        outcome,
        ...(errorCategory ? { errorCategory } : {}),
      },
    });
  } catch {
    console.error("Google Meet co-host audit failed", {
      organizationId: user.organization_id,
      meetingId: meeting.id,
      outcome,
    });
  }
}

async function assignOperatorCohost(client, meeting, user, options = {}) {
  try {
    const operator = (await client.query(
      `SELECT google_meet_email
       FROM users
       WHERE id=$1 AND organization_id=$2`,
      [user.id, user.organization_id],
    )).rows[0];
    if (!operator?.google_meet_email) {
      await recordCohostAudit(client, meeting, user, "MISSING_EMAIL");
      return {
        cohostAssignment: "MISSING_EMAIL",
        cohostWarning: OPERATOR_EMAIL_MISSING_WARNING,
      };
    }

    let accessToken = options.accessToken;
    if (!accessToken) {
      const connection = await loadActiveGoogleConnection(client, user.organization_id);
      if (!connection) throw new AppError("Google Meet is not connected.", "GOOGLE_NOT_CONNECTED", 409);
      accessToken = await refreshGoogleAccessToken(decryptGoogleRefreshToken(connection), { fetchImpl: options.fetchImpl });
    }
    const membership = await createGoogleMeetCohost(
      accessToken,
      meeting.google_meet_space_name,
      operator.google_meet_email,
      { fetchImpl: options.fetchImpl, wait: options.wait },
    );
    const outcome = membership.ready
      ? (membership.alreadyAssigned ? "ALREADY_ASSIGNED" : "READY")
      : "PENDING";
    await recordCohostAudit(client, meeting, user, outcome);
    return { cohostAssignment: outcome, cohostWarning: null };
  } catch (error) {
    const errorCategory = error?.code || "GOOGLE_UNKNOWN";
    console.error("Google Meet co-host assignment failed", {
      organizationId: user.organization_id,
      meetingId: meeting.id,
      operatorUserId: user.id,
      errorCategory,
    });
    await recordCohostAudit(client, meeting, user, "FAILED", errorCategory);
    return {
      cohostAssignment: "FAILED",
      cohostWarning: COHOST_ASSIGNMENT_FAILED_WARNING,
    };
  }
}

async function withMeetingCreationLock(dbPool, meetingId, work) {
  const client = await dbPool.connect();
  const lockKey = `google-meet:${meetingId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    return await work(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => {});
    client.release();
  }
}

async function meetingForGoogle(client, groupId, meetingId, user) {
  const meeting = (await client.query(
    `SELECT id,organization_id,group_id,status,meeting_mode,virtual_meeting_url,google_meet_space_name
     FROM vsla_meetings
     WHERE id=$1 AND group_id=$2 AND organization_id=$3`,
    [meetingId, groupId, user.organization_id],
  )).rows[0];
  if (!meeting) throw new NotFoundError("Meeting not found");
  if (!["VIRTUAL", "HYBRID"].includes(meeting.meeting_mode)) {
    throw new ValidationError("Google Meet can only be created for a Virtual or Hybrid meeting.");
  }
  if (meeting.status !== "OPEN") throw new ConflictError("Google Meet can only be changed while the meeting is open.");
  return meeting;
}

function existingMeetingResult(meeting) {
  if (meeting.google_meet_space_name && !isGoogleMeetUrl(meeting.virtual_meeting_url)) {
    throw new ConflictError("Google Meet metadata is incomplete. Contact Visave support before retrying.");
  }
  if (isGoogleMeetUrl(meeting.virtual_meeting_url)) {
    return {
      meeting,
      created: false,
      source: meeting.google_meet_space_name ? "GOOGLE" : "MANUAL",
    };
  }
  return null;
}

export async function createGoogleMeetForMeeting(groupId, meetingId, user, options = {}) {
  const dbPool = options.pool || pool;
  return withMeetingCreationLock(dbPool, meetingId, async (client) => {
    const meeting = await meetingForGoogle(client, groupId, meetingId, user);
    const existing = existingMeetingResult(meeting);
    if (existing) {
      if (existing.source === "MANUAL") return existing;
      const cohost = await assignOperatorCohost(client, meeting, user, options);
      return { ...existing, ...cohost };
    }

    const connection = await loadActiveGoogleConnection(client, user.organization_id);
    if (!connection) {
      throw new AppError(
        "Google Meet is not connected. Ask a Visave administrator to connect the organization Google account, or use an existing Meet link.",
        "GOOGLE_NOT_CONNECTED",
        409,
      );
    }
    const refreshToken = decryptGoogleRefreshToken(connection);
    const accessToken = await refreshGoogleAccessToken(refreshToken, { fetchImpl: options.fetchImpl });
    const space = await createGoogleMeetSpace(accessToken, {
      fetchImpl: options.fetchImpl,
      accessType: options.accessType,
    });

    await client.query("BEGIN");
    try {
      const updated = (await client.query(
        `UPDATE vsla_meetings
         SET virtual_meeting_url=$4,google_meet_space_name=$5,updated_at=now()
         WHERE id=$1 AND group_id=$2 AND organization_id=$3
           AND virtual_meeting_url IS NULL AND google_meet_space_name IS NULL
         RETURNING *`,
        [meetingId, groupId, user.organization_id, space.meetingUri, space.name],
      )).rows[0];
      if (!updated) throw new ConflictError("Google Meet details changed during creation. Reopen the meeting and try again.");
      await writeAudit(client, {
        organizationId: user.organization_id,
        actorUserId: user.id,
        action: "GOOGLE_MEET_SPACE_CREATED",
        entityType: "VSLA_MEETING",
        entityId: meetingId,
        newValues: {
          meetingMode: updated.meeting_mode,
          googleMeetSpaceName: updated.google_meet_space_name,
          virtualMeetingUrl: "[REDACTED]",
          accessType: space.accessType,
        },
      });
      await client.query("COMMIT");
      const cohost = await assignOperatorCohost(client, updated, user, {
        ...options,
        accessToken,
      });
      return {
        meeting: updated,
        created: true,
        source: "GOOGLE",
        accessType: space.accessType,
        ...cohost,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function setManualGoogleMeetForMeeting(groupId, meetingId, virtualMeetingUrl, user, options = {}) {
  const meetingUri = normalizeGoogleMeetUrl(virtualMeetingUrl);
  if (!meetingUri) throw new ValidationError("Enter a valid HTTPS Google Meet link from meet.google.com");
  const dbPool = options.pool || pool;
  return withMeetingCreationLock(dbPool, meetingId, async (client) => {
    const meeting = await meetingForGoogle(client, groupId, meetingId, user);
    const existing = existingMeetingResult(meeting);
    if (existing) return existing;
    await client.query("BEGIN");
    try {
      const updated = (await client.query(
        `UPDATE vsla_meetings
         SET virtual_meeting_url=$4,updated_at=now()
         WHERE id=$1 AND group_id=$2 AND organization_id=$3
           AND virtual_meeting_url IS NULL AND google_meet_space_name IS NULL
         RETURNING *`,
        [meetingId, groupId, user.organization_id, meetingUri],
      )).rows[0];
      if (!updated) throw new ConflictError("Meeting link changed. Reopen the meeting and try again.");
      await writeAudit(client, {
        organizationId: user.organization_id,
        actorUserId: user.id,
        action: "MANUAL_GOOGLE_MEET_LINK_ADDED",
        entityType: "VSLA_MEETING",
        entityId: meetingId,
        newValues: { meetingMode: updated.meeting_mode, virtualMeetingUrl: "[REDACTED]" },
      });
      await client.query("COMMIT");
      return { meeting: updated, created: true, source: "MANUAL" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
