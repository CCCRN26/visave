import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { NotFoundError } from "@/lib/errors";

export async function getGoogleMeetIdentity(user, client = pool) {
  const identity = (await client.query(
    `SELECT google_meet_email
     FROM users
     WHERE id=$1 AND organization_id=$2`,
    [user.id, user.organization_id],
  )).rows[0];
  if (!identity) throw new NotFoundError("User not found");
  return { googleMeetEmail: identity.google_meet_email };
}

export async function updateGoogleMeetIdentity(user, googleMeetEmail) {
  return withTransaction(async (client) => {
    const current = (await client.query(
      `SELECT google_meet_email
       FROM users
       WHERE id=$1 AND organization_id=$2
       FOR UPDATE`,
      [user.id, user.organization_id],
    )).rows[0];
    if (!current) throw new NotFoundError("User not found");
    const updated = (await client.query(
      `UPDATE users
       SET google_meet_email=$3,updated_at=now()
       WHERE id=$1 AND organization_id=$2
       RETURNING google_meet_email`,
      [user.id, user.organization_id, googleMeetEmail],
    )).rows[0];
    await writeAudit(client, {
      organizationId: user.organization_id,
      actorUserId: user.id,
      action: "GOOGLE_MEET_IDENTITY_UPDATED",
      entityType: "USER",
      entityId: user.id,
      oldValues: { configured: Boolean(current.google_meet_email) },
      newValues: { configured: Boolean(updated.google_meet_email) },
    });
    return { googleMeetEmail: updated.google_meet_email };
  });
}
