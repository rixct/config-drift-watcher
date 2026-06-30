import { Client } from "ssh2";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ServerProfile } from "./types";

/** Thrown for any failure while reading a remote file. Message is user-facing. */
export class RemoteReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteReadError";
  }
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
 * NOTE: host key verification (known_hosts / TOFU pinning) is not yet
 * implemented — see the roadmap. Connections currently trust the host key.
 */
export function readRemoteFile(
  profile: ServerProfile,
  remotePath: string,
  timeoutMs: number,
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
        fail(`Connection to ${profile.host}:${profile.port} failed: ${err.message}`);
      })
      .connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        privateKey,
        passphrase: profile.passphrase || undefined,
        readyTimeout: timeoutMs,
      });
  });
}
