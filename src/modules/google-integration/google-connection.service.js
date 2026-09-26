import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { encryptGoogleRefreshToken, decryptGoogleRefreshToken } from "@/lib/security/google-token-encryption";
import { revokeGoogleToken } from "./google-oauth";

export async function getGoogleConnectionStatus(organizationId) {
  const connection = (await pool.query(
    `SELECT connected_email,connected_at,updated_at
     FROM organization_google_oauth_connections
     WHERE organization_id=$1 AND revoked_at IS NULL
     ORDER BY connected_at DESC LIMIT 1`,
    [organizationId],
  )).rows[0];
  return connection ? {
    connected: true,
    connectedEmail: connection.connected_email,
    connectedAt: connection.connected_at,
    updatedAt: connection.updated_at,
  } : { connected: false };
}

export async function loadActiveGoogleConnection(client, organizationId) {
  return (await client.query(
    `SELECT * FROM organization_google_oauth_connections
     WHERE organization_id=$1 AND revoked_at IS NULL
     ORDER BY connected_at DESC LIMIT 1`,
    [organizationId],
  )).rows[0] || null;
}

async function revokePreviousConnection(connection, fetchImpl) {
  if (!connection) return false;
  try {
    const refreshToken = decryptGoogleRefreshToken(connection);
    return await revokeGoogleToken(refreshToken, { fetchImpl });
  } catch {
    return false;
  }
}

export async function connectGoogleAccount(user, data, { fetchImpl = globalThis.fetch } = {}) {
  const encrypted = encryptGoogleRefreshToken(data.refreshToken);
  const result = await withTransaction(async (client) => {
    await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [user.organization_id]);
    const previous = await loadActiveGoogleConnection(client, user.organization_id);
    if (previous) {
      await client.query(
        `UPDATE organization_google_oauth_connections
         SET revoked_at=now(),updated_at=now()
         WHERE id=$1 AND revoked_at IS NULL`,
        [previous.id],
      );
    }
    const connection = (await client.query(
      `INSERT INTO organization_google_oauth_connections(
        organization_id,provider,connected_email,encrypted_refresh_token,token_iv,token_auth_tag,
        encryption_key_version,scopes,connected_by
       ) VALUES($1,'GOOGLE',$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,connected_email,connected_at`,
      [
        user.organization_id,
        data.email,
        encrypted.encryptedRefreshToken,
        encrypted.tokenIv,
        encrypted.tokenAuthTag,
        encrypted.encryptionKeyVersion,
        data.scopes,
        user.id,
      ],
    )).rows[0];
    await writeAudit(client, {
      organizationId: user.organization_id,
      actorUserId: user.id,
      action: previous ? "GOOGLE_CONNECTION_REPLACED" : "GOOGLE_CONNECTION_CREATED",
      entityType: "GOOGLE_OAUTH_CONNECTION",
      entityId: connection.id,
      newValues: { connectedEmail: connection.connected_email, scopes: data.scopes },
    });
    return { connection, previous };
  });

  await revokePreviousConnection(result.previous, fetchImpl);
  return {
    connected: true,
    connectedEmail: result.connection.connected_email,
    connectedAt: result.connection.connected_at,
  };
}

export async function disconnectGoogleAccount(user, { fetchImpl = globalThis.fetch } = {}) {
  const connection = await withTransaction(async (client) => {
    await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [user.organization_id]);
    const active = await loadActiveGoogleConnection(client, user.organization_id);
    if (!active) return null;
    await client.query(
      `UPDATE organization_google_oauth_connections
       SET revoked_at=now(),updated_at=now()
       WHERE id=$1 AND revoked_at IS NULL`,
      [active.id],
    );
    await writeAudit(client, {
      organizationId: user.organization_id,
      actorUserId: user.id,
      action: "GOOGLE_CONNECTION_REVOKED",
      entityType: "GOOGLE_OAUTH_CONNECTION",
      entityId: active.id,
      oldValues: { connectedEmail: active.connected_email },
      newValues: { connected: false },
    });
    return active;
  });

  const providerRevoked = await revokePreviousConnection(connection, fetchImpl);
  return {
    connected: false,
    providerRevocationAttempted: Boolean(connection),
    providerRevoked,
  };
}
