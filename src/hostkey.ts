import { createHash } from "crypto";

/**
 * Compute the OpenSSH-style SHA-256 fingerprint of a host key, e.g.
 * `SHA256:Zm9vYmFy...`. This matches what `ssh-keygen -lf` and the
 * `known_hosts` tooling print, so users can compare it by eye.
 */
export function hostKeyFingerprint(key: Buffer): string {
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return "SHA256:" + digest;
}

export type HostKeyDecision =
  | { ok: true }
  | { ok: false; expected: string; actual: string };

/**
 * Verify a presented host key against an expected fingerprint.
 *
 * - No expected fingerprint -> trust on first use (the caller should persist
 *   the returned fingerprint so later connections are pinned).
 * - Matching fingerprint -> accepted.
 * - Differing fingerprint -> rejected; the server changed or a
 *   machine-in-the-middle is intercepting the connection.
 */
export function verifyHostKey(
  key: Buffer,
  expected: string | undefined,
): { fingerprint: string; decision: HostKeyDecision } {
  const fingerprint = hostKeyFingerprint(key);
  const want = expected?.trim();
  if (!want) return { fingerprint, decision: { ok: true } };
  if (fingerprint === want) return { fingerprint, decision: { ok: true } };
  return { fingerprint, decision: { ok: false, expected: want, actual: fingerprint } };
}
