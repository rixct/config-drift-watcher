import { createHmac } from "crypto";

export interface KnownHostsEntry {
  /** Comma-separated host patterns (may be hashed "|1|salt|hash"). */
  patterns: string[];
  /** Key type, e.g. "ssh-ed25519", "ssh-rsa". */
  keyType: string;
  /** Base64 of the host public key blob. */
  keyBase64: string;
}

/** Parse the contents of a known_hosts file. Unsupported lines are skipped. */
export function parseKnownHosts(content: string): KnownHostsEntry[] {
  const entries: KnownHostsEntry[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Skip markers like @cert-authority / @revoked — we do not do CA validation.
    if (line.startsWith("@")) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    entries.push({
      patterns: fields[0].split(","),
      keyType: fields[1],
      keyBase64: fields[2],
    });
  }
  return entries;
}

/** The token OpenSSH uses to identify a host: "host" or "[host]:port". */
export function hostToken(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function patternMatches(pattern: string, token: string): boolean {
  if (pattern.startsWith("|1|")) {
    // Hashed host: |1|<base64 salt>|<base64 HMAC-SHA1(salt, token)>
    const parts = pattern.split("|");
    if (parts.length !== 4) return false;
    const salt = Buffer.from(parts[2], "base64");
    const expected = parts[3];
    const mac = createHmac("sha1", salt).update(token).digest("base64");
    return mac === expected;
  }
  return pattern === token;
}

export type KnownHostsStatus =
  | { status: "match" }
  | { status: "mismatch" }
  | { status: "absent" };

/**
 * Decide whether the presented host key is trusted according to known_hosts.
 *
 * Only entries for the same host AND same key type are considered (matching
 * OpenSSH behaviour), so a server switching key algorithms is treated as an
 * unknown host rather than a scary mismatch.
 *
 * - match: an entry for this host/type has exactly this key.
 * - mismatch: entries exist for this host/type but none match — the key changed.
 * - absent: no entry for this host/type — caller should fall back (TOFU/pin).
 */
export function checkKnownHosts(
  entries: KnownHostsEntry[],
  host: string,
  port: number,
  presentedKeyType: string,
  presentedKeyBase64: string,
): KnownHostsStatus {
  const token = hostToken(host, port);
  let sawHostType = false;
  for (const e of entries) {
    if (e.keyType !== presentedKeyType) continue;
    if (!e.patterns.some((p) => patternMatches(p, token))) continue;
    sawHostType = true;
    if (e.keyBase64 === presentedKeyBase64) return { status: "match" };
  }
  return sawHostType ? { status: "mismatch" } : { status: "absent" };
}
