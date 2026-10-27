import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const AAD_PREFIX = "outreach:inbox-refresh-token:";

/** TOKEN_ENCRYPTION_KEY is 32 random bytes, base64 (openssl rand -base64 32). */
export function parseEncryptionKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64.trim(), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32)");
  return key;
}

/**
 * AES-256-GCM. The inbox id is bound into the ciphertext as additional authenticated data, so a token copied from one
 * inbox row to another no longer decrypts. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export function encryptToken(plain: string, keyB64: string, inboxId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", parseEncryptionKey(keyB64), iv);
  cipher.setAAD(Buffer.from(AAD_PREFIX + inboxId));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(blob: string, keyB64: string, inboxId: string): string {
  const [version, iv, tag, ct] = blob.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Stored token has an unknown format");
  const decipher = createDecipheriv("aes-256-gcm", parseEncryptionKey(keyB64), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(AAD_PREFIX + inboxId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored token could not be decrypted (wrong TOKEN_ENCRYPTION_KEY, or the token belongs to another inbox)");
  }
}
