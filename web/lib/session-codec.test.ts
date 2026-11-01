import { describe, expect, test } from "bun:test";
import { decryptSession, encryptSession, statesMatch } from "./session-codec";

const secret = "test-secret-with-at-least-32-characters";
const now = 1_800_000_000_000;
const session = { token: "github-test-token", expiresAt: now + 60_000 };

describe("encrypted sessions", () => {
  test("round trip hides tokens and uses a fresh nonce", () => {
    const a = encryptSession(session, secret);
    const b = encryptSession(session, secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain(session.token);
    expect(decryptSession(a, secret, now)).toEqual(session);
  });
  test("rejects changes to nonce, tag, or ciphertext", () => {
    const encoded = encryptSession(session, secret);
    for (const index of [0, 12, 28]) {
      const bytes = Buffer.from(encoded, "base64url");
      bytes[index] ^= 1;
      expect(
        decryptSession(bytes.toString("base64url"), secret, now),
      ).toBeNull();
    }
  });
  test("rejects another key and cookie purpose", () => {
    const encoded = encryptSession(session, secret);
    expect(decryptSession(encoded, secret + "different", now)).toBeNull();
    expect(decryptSession(encoded, secret, now, "oauth-state")).toBeNull();
  });
  test("rejects expired sessions at the exact expiry boundary", () => {
    const encoded = encryptSession(session, secret);
    expect(decryptSession(encoded, secret, session.expiresAt - 1)).toEqual(
      session,
    );
    expect(decryptSession(encoded, secret, session.expiresAt)).toBeNull();
    expect(decryptSession(encoded, secret, session.expiresAt + 1)).toBeNull();
  });
  test("rejects malformed, absent, oversized cookies and weak keys", () => {
    for (const value of [undefined, "", "abc", "!bad", "a".repeat(4000)])
      expect(decryptSession(value, secret, now)).toBeNull();
    expect(() => encryptSession(session, "short")).toThrow("SESSION_SECRET");
    expect(() =>
      encryptSession({ ...session, token: "a".repeat(4000) }, secret),
    ).toThrow("size");
  });
  test("compares OAuth states and enforces their expiry", () => {
    expect(statesMatch("same-state", "same-state")).toBe(true);
    expect(statesMatch("same-state", "evil-state")).toBe(false);
    expect(statesMatch("same-state", "")).toBe(false);
    const encoded = encryptSession(session, secret, "oauth-state");
    expect(decryptSession(encoded, secret, now, "oauth-state")).toEqual(
      session,
    );
    expect(
      decryptSession(encoded, secret, session.expiresAt, "oauth-state"),
    ).toBeNull();
  });
});
