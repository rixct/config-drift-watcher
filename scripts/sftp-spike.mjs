// Phase 0 de-risk: prove that ssh2 can perform an SFTP read in this runtime.
//
// There is no external SSH server available in the sandbox, so this spike is
// self-contained: it spins up an in-process ssh2 SFTP server on localhost with
// an ephemeral host key, then connects with the ssh2 client and reads a file
// over SFTP. It exercises the exact library and the exact SFTP READ path that
// the plugin will ship with. If this passes, ssh2 loads and SFTP reads work.

import { generateKeyPairSync } from "crypto";
import { createRequire } from "module";

// ssh2 is CommonJS and does not surface named ESM exports, so require it.
const require = createRequire(import.meta.url);
const { Server, Client, utils } = require("ssh2");
// STATUS_CODE is not re-exported from the package root, reach it via the
// internal SFTP module (same approach the ssh2 server docs use).
const { STATUS_CODE } = require("ssh2/lib/protocol/SFTP.js");

const SAMPLE_PATH = "/etc/network/interfaces";
const SAMPLE_CONTENT = [
  "auto eth0",
  "iface eth0 inet dhcp",
  "iface eth0 inet6 manual",
  "",
].join("\n");

// Ephemeral RSA host key for the throwaway server.
const { privateKey: hostKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

function startServer() {
  return new Promise((resolve) => {
    const server = new Server({ hostKeys: [hostKey] }, (client) => {
      client
        .on("authentication", (ctx) => ctx.accept())
        .on("ready", () => {
          client.on("session", (acceptSession) => {
            const session = acceptSession();
            session.on("sftp", (acceptSftp) => {
              const sftp = acceptSftp();
              const handles = new Map();
              let nextHandle = 0;

              sftp.on("OPEN", (reqid, filename) => {
                if (filename !== SAMPLE_PATH) {
                  return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
                }
                const h = Buffer.alloc(4);
                const id = nextHandle++;
                h.writeUInt32BE(id, 0);
                handles.set(id, { offset: 0, data: Buffer.from(SAMPLE_CONTENT) });
                sftp.handle(reqid, h);
              });

              sftp.on("READ", (reqid, handle, offset, length) => {
                const id = handle.readUInt32BE(0);
                const entry = handles.get(id);
                if (!entry) return sftp.status(reqid, STATUS_CODE.FAILURE);
                if (offset >= entry.data.length) {
                  return sftp.status(reqid, STATUS_CODE.EOF);
                }
                const chunk = entry.data.subarray(offset, offset + length);
                sftp.data(reqid, chunk);
              });

              sftp.on("FSTAT", (reqid, handle) => {
                const id = handle.readUInt32BE(0);
                const entry = handles.get(id);
                if (!entry) return sftp.status(reqid, STATUS_CODE.FAILURE);
                sftp.attrs(reqid, { size: entry.data.length, mode: 0o100644 });
              });

              sftp.on("CLOSE", (reqid, handle) => {
                const id = handle.readUInt32BE(0);
                handles.delete(id);
                sftp.status(reqid, STATUS_CODE.OK);
              });
            });
          });
        });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function readViaClient(port) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) return reject(err);
          const stream = sftp.createReadStream(SAMPLE_PATH);
          const chunks = [];
          stream.on("data", (d) => chunks.push(d));
          stream.on("error", reject);
          stream.on("end", () => {
            conn.end();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
      })
      .on("error", reject)
      .connect({
        host: "127.0.0.1",
        port,
        username: "spike",
        password: "ignored", // server accepts any auth
      });
  });
}

async function main() {
  console.log("ssh2 loaded:", typeof Server === "function" && typeof Client === "function");
  console.log("parseKey available:", typeof utils.parseKey === "function");

  const server = await startServer();
  const { port } = server.address();
  console.log(`in-process SFTP server listening on 127.0.0.1:${port}`);

  const content = await readViaClient(port);
  server.close();

  const ok = content === SAMPLE_CONTENT;
  console.log("--- file read over SFTP ---");
  console.log(content);
  console.log("--- result ---");
  console.log(ok ? "PASS: SFTP read returned exact content" : "FAIL: content mismatch");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("SPIKE FAILED:", err);
  process.exit(1);
});
