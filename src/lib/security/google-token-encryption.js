import crypto from "node:crypto";
import { AppError } from "@/lib/errors";

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;

function encryptionKey() {
  const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new AppError(
      "Google token encryption is not configured correctly.",
      "GOOGLE_TOKEN_ENCRYPTION_INVALID",
      503,
    );
  }
  return key;
}

export function encryptGoogleRefreshToken(refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new AppError("Google did not return a refresh token.", "GOOGLE_REFRESH_TOKEN_MISSING", 400);
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return {
    encryptedRefreshToken: encrypted.toString("base64url"),
    tokenIv: iv.toString("base64url"),
    tokenAuthTag: cipher.getAuthTag().toString("base64url"),
    encryptionKeyVersion: KEY_VERSION,
  };
}

export function decryptGoogleRefreshToken(connection) {
  try {
    if (connection.encryption_key_version !== KEY_VERSION) throw new Error("Unsupported key version");
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(connection.token_iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(connection.token_auth_tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(connection.encrypted_refresh_token, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "The Google connection could not be decrypted. Ask a Visave administrator to reconnect Google Meet.",
      "GOOGLE_TOKEN_DECRYPTION_FAILED",
      503,
    );
  }
}
