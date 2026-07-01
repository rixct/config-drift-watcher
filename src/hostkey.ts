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

/**
 * Extract the key type from an SSH host key blob (e.g. "ssh-ed25519").
 * The wire format begins with a uint32 length followed by the type string.
 */
export function hostKeyType(key: Buffer): string {
  if (key.length < 4) return "";
  const len = key.readUInt32BE(0);
  if (len <= 0 || 4 + len > key.length) return "";
  return key.subarray(4, 4 + len).toString("ascii");
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
