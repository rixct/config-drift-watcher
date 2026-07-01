import { Client } from "ssh2";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ServerProfile } from "./types";
import { verifyHostKey, hostKeyType } from "./hostkey";
import { parseKnownHosts, checkKnownHosts } from "./knownhosts";
import { isBinary } from "./binary";

/** Thrown for any failure while reading a remote file. Message is user-facing. */
export class RemoteReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteReadError";
  }
}

export interface ReadOptions {
  timeoutMs: number;
  /** Pinned host key fingerprint to verify against. Empty = trust on first use. */
  expectedFingerprint?: string;
  /** Called with the server's fingerprint once the host key is seen. */
  onHostKey?: (fingerprint: string) => void;
  /** If set, verify the host key against this known_hosts file first. */
  knownHostsPath?: string;
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function loadKnownHosts(path: string | undefined) {
  if (!path) return null;
  try {
    return parseKnownHosts(readFileSync(expandTilde(path), "utf8"));
  } catch {
    // No known_hosts file (or unreadable) — treat as "no entries" and fall back.
    return null;
  }
}

/**
 * Read a remote file over SFTP, read-only.
 *
 * No shell command is ever executed: an SFTP read can only read a file, it
 * cannot run code on the remote host, regardless of how the path is formed.
 *
 * Host key trust order: known_hosts (if provided) → pinned fingerprint → trust
 * on first use (reported via `onHostKey` so the caller can persist it).
 */
export function readRemoteFile(
  profile: ServerProfile,
  remotePath: string,
  opts: ReadOptions,
): Promise<string> {
  let privateKey: Buffer;
  try {
    privateKey = readFileSync(expandTilde(profile.privateKeyPath));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return Promise.reject(
      new RemoteReadError(
        `Cannot read private key at ${profile.privateKeyPath}: ${reason}`,
      ),
    );
  }

  const knownHosts = loadKnownHosts(opts.knownHostsPath);

  return new Promise<string>((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let hostKeyError: string | null = null;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(new RemoteReadError(message));
    };

    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) return fail(`SFTP session failed: ${err.message}`);

          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(remotePath);

          stream.on("data", (d: Buffer) => chunks.push(d));
          stream.on("error", (e: NodeJS.ErrnoException) => {
            const hint =
              e.code === "ENOENT"
                ? `Remote file not found: ${remotePath}`
                : e.code === "EACCES"
                  ? `Permission denied reading ${remotePath} as ${profile.username}`
                  : `Failed to read ${remotePath}: ${e.message}`;
            fail(hint);
          });
          stream.on("end", () => {
            if (settled) return;
            const buf = Buffer.concat(chunks);
            if (isBinary(buf)) {
              return fail(
                `Remote file appears to be binary: ${remotePath}. ` +
                  `Drift comparison only supports text files.`,
              );
            }
            settled = true;
            conn.end();
            resolve(buf.toString("utf8"));
          });
        });
      })
      .on("error", (err: Error) => {
        fail(hostKeyError ?? `Connection to ${profile.host}:${profile.port} failed: ${err.message}`);
      })
      .connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        privateKey,
        passphrase: profile.passphrase || undefined,
        readyTimeout: opts.timeoutMs,
        hostVerifier: (key: Buffer): boolean => {
          const fingerprint = verifyHostKey(key, opts.expectedFingerprint).fingerprint;
          opts.onHostKey?.(fingerprint);

          // 1) known_hosts takes precedence when it has an entry for this host.
          if (knownHosts) {
            const kh = checkKnownHosts(
              knownHosts,
              profile.host,
              profile.port,
              hostKeyType(key),
              key.toString("base64"),
            );
            if (kh.status === "match") return true;
            if (kh.status === "mismatch") {
              hostKeyError =
                `Host key mismatch for ${profile.host}: the key does not match the ` +
                `entry in known_hosts. The server may have changed, or a ` +
                `machine-in-the-middle is intercepting the connection. Fingerprint ` +
                `presented: ${fingerprint}.`;
              return false;
            }
            // absent → fall through to pin/TOFU
          }

          // 2) Pinned fingerprint / trust on first use.
          const decision = verifyHostKey(key, opts.expectedFingerprint).decision;
          if (decision.ok) return true;
          hostKeyError =
            `Host key mismatch for ${profile.host}. Expected ${decision.expected} ` +
            `but the server presented ${decision.actual}. The server may have ` +
            `changed, or a machine-in-the-middle is intercepting the connection. ` +
            `If you trust the change, clear the fingerprint for "${profile.alias}" ` +
            `in settings and reconnect.`;
          return false;
        },
      });
  });
}
