import crypto from "node:crypto";
export function newSessionToken(){return crypto.randomBytes(32).toString("base64url");}
export function hashToken(token){return crypto.createHash("sha256").update(token).digest("hex");}
