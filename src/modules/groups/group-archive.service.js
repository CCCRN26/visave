import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";

export async function archiveGroup(groupId, data, user) {
  return withTransaction(async (client) => {
    const group = (await client.query("SELECT * FROM vsla_groups WHERE id=$1 AND organization_id=$2 FOR UPDATE", [groupId, user.organization_id])).rows[0];
    if (!group) throw new NotFoundError("Group not found");
    if (group.status === "ARCHIVED") throw new ConflictError("Group is already archived");
    if ((await client.query("SELECT 1 FROM vsla_meetings WHERE group_id=$1 AND status='OPEN' LIMIT 1 FOR UPDATE", [groupId])).rowCount)
      throw new AppError("Close or cancel the open meeting before archiving this group", "GROUP_ARCHIVE_BLOCKED_OPEN_MEETING", 409);
    if ((await client.query("SELECT 1 FROM cycle_shareouts WHERE group_id=$1 AND status IN('DRAFT','APPROVED','PAYOUT_IN_PROGRESS') LIMIT 1", [groupId])).rowCount)
      throw new AppError("Complete the current share-out transition before archiving this group", "GROUP_ARCHIVE_BLOCKED_TRANSITION", 409);
    const archived = (await client.query("UPDATE vsla_groups SET status='ARCHIVED',public_visibility='HIDDEN',membership_intake_status='CLOSED',updated_at=now() WHERE id=$1 RETURNING *", [groupId])).rows[0];
    await writeAudit(client, { organizationId: group.organization_id, actorUserId: user.id, action: "GROUP_ARCHIVED", entityType: "VSLA_GROUP", entityId: group.id, oldValues: { status: group.status, publicVisibility: group.public_visibility, membershipIntakeStatus: group.membership_intake_status }, newValues: { status: "ARCHIVED", archivedAt: new Date().toISOString(), reason: data.reason } });
    return archived;
  });
}
