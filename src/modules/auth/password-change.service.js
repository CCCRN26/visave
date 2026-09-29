import bcrypt from "bcryptjs";
import { withTransaction } from "@/lib/db/transaction";
import { AppError, AuthenticationError, ValidationError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit/audit.service";

export async function changeForcedPasswordWithClient(client, user, newPassword, passwordTools = bcrypt) {
  const current = (await client.query(
    "SELECT password_hash,must_change_password FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
    [user.id],
  )).rows[0];
  if (!current) throw new AuthenticationError();
  if (!current.must_change_password) {
    throw new AppError("A password change is not required for this account.", "PASSWORD_CHANGE_NOT_REQUIRED", 409);
  }
  if (await passwordTools.compare(newPassword, current.password_hash)) {
    throw new ValidationError("Choose a new password that is different from your temporary password.");
  }

  const passwordHash = await passwordTools.hash(newPassword, 12);
  const updated = (await client.query(
    "UPDATE users SET password_hash=$2,must_change_password=false,updated_at=now() WHERE id=$1 AND must_change_password=true RETURNING id",
    [user.id, passwordHash],
  )).rows[0];
  if (!updated) throw new AppError("Your password could not be updated. Please try again.", "PASSWORD_CHANGE_FAILED", 409);

  await writeAudit(client, {
    organizationId: user.organization_id,
    actorUserId: user.id,
    action: "USER_FORCED_PASSWORD_CHANGED",
    entityType: "USER",
    entityId: user.id,
  });
  return { changed: true };
}

export async function changeForcedPassword(data, user) {
  return withTransaction((client) => changeForcedPasswordWithClient(client, user, data.newPassword));
}
