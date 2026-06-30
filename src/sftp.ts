import { Client } from "ssh2";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ServerProfile } from "./types";
import { verifyHostKey, HostKeyDecision } from "./hostkey";

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
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Read a remote file over SFTP, read-only.
 *
 * No shell command is ever executed: an SFTP read can only read a file, it
 * cannot run code on the remote host, regardless of how the path is formed.
 *
 * The server's host key is verified against `expectedFingerprint` (when set).
 * With no pinned fingerprint, the key is trusted on first use and reported via
 * `onHostKey` so the caller can persist it for later connections.
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

  return new Promise<string>((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let mismatch: { expected: string; actual: string } | null = null;

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
            settled = true;
            conn.end();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
      })
      .on("error", (err: Error) => {
        if (mismatch) {
          return fail(
            `Host key mismatch for ${profile.host}. Expected ${mismatch.expected} ` +
              `but the server presented ${mismatch.actual}. The server may have ` +
              `changed, or a machine-in-the-middle is intercepting the connection. ` +
              `If you trust the change, clear the fingerprint for "${profile.alias}" ` +
              `in settings and reconnect.`,
          );
        }
        fail(`Connection to ${profile.host}:${profile.port} failed: ${err.message}`);
      })
      .connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        privateKey,
        passphrase: profile.passphrase || undefined,
        readyTimeout: opts.timeoutMs,
        hostVerifier: (key: Buffer): boolean => {
          const { fingerprint, decision }: { fingerprint: string; decision: HostKeyDecision } =
            verifyHostKey(key, opts.expectedFingerprint);
          opts.onHostKey?.(fingerprint);
          if (decision.ok) return true;
          mismatch = { expected: decision.expected, actual: decision.actual };
          return false;
        },
      });
  });
}
