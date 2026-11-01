import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_TTL = 8 * 60 * 60;
export type Session = { token: string; expiresAt: number };
type Purpose = "session" | "oauth-state";

function key(secret: string) {
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function encryptSession(
  session: Session,
  secret: string,
  purpose: Purpose = "session",
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`crocode:v1:${purpose}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const encoded = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
  if (encoded.length > 3800)
    throw new Error("Session exceeds cookie size limit");
  return encoded;
}

export function decryptSession(
  value: string | undefined,
  secret: string,
  now = Date.now(),
  purpose: Purpose = "session",
): Session | null {
  const encryptionKey = key(secret);
  if (!value || value.length > 3800 || !/^[A-Za-z0-9_-]+$/.test(value))
    return null;
  try {
    const data = Buffer.from(value, "base64url");
    if (data.length <= 28) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      data.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(`crocode:v1:${purpose}`));
    decipher.setAuthTag(data.subarray(12, 28));
    const session: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      !session ||
      typeof session !== "object" ||
      !("token" in session) ||
      typeof session.token !== "string" ||
      !session.token ||
      !("expiresAt" in session) ||
      typeof session.expiresAt !== "number" ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= now
    )
      return null;
    return { token: session.token, expiresAt: session.expiresAt };
  } catch {
    return null;
  }
}

export function statesMatch(expected: string, received: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
