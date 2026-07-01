// Tests for the 1.1.0 features: binary detection, diff collapsing, host key
// type parsing, and known_hosts verification. Run via: npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");

const { isBinary } = require("../.test-build/binary.js");
const { collapseDiff } = require("../.test-build/collapse.js");
const { hostKeyType, hostKeyFingerprint } = require("../.test-build/hostkey.js");
const {
  parseKnownHosts,
  checkKnownHosts,
  hostToken,
} = require("../.test-build/knownhosts.js");

// ---- binary detection ----

test("isBinary: NUL byte means binary", () => {
  assert.equal(isBinary(Buffer.from([0x61, 0x00, 0x62])), true);
});

test("isBinary: plain text is not binary", () => {
  assert.equal(isBinary(Buffer.from("auto eth0\niface eth0 inet dhcp\n")), false);
});

// ---- diff collapsing ----

const ctx = (v) => ({ type: "context", value: v });
const add = (v) => ({ type: "added", value: v });

test("collapseDiff: collapses far-away context into a gap", () => {
  const lines = [
    ctx("a"), ctx("b"), ctx("c"), ctx("d"), ctx("e"),
    add("CHANGED"),
    ctx("f"), ctx("g"), ctx("h"), ctx("i"), ctx("j"),
  ];
  const rows = collapseDiff(lines, 1);
  // context 1 keeps e, CHANGED, f; a..d and g..j collapse into two gaps.
  const gaps = rows.filter((r) => r.kind === "gap");
  const shown = rows.filter((r) => r.kind === "line").map((r) => r.line.value);
  assert.equal(gaps.length, 2);
  assert.deepEqual(shown, ["e", "CHANGED", "f"]);
  assert.equal(gaps[0].hidden.length, 4); // a b c d
  assert.equal(gaps[1].hidden.length, 4); // g h i j
});

test("collapseDiff: no gaps when everything is within context", () => {
  const lines = [ctx("a"), add("x"), ctx("b")];
  const rows = collapseDiff(lines, 3);
  assert.ok(rows.every((r) => r.kind === "line"));
  assert.equal(rows.length, 3);
});

// ---- host key type ----

function keyBlob(type, body) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(t.length, 0);
  return Buffer.concat([len, t, Buffer.from(body || "keybytes")]);
}

test("hostKeyType: reads the algorithm from the blob", () => {
  assert.equal(hostKeyType(keyBlob("ssh-ed25519")), "ssh-ed25519");
  assert.equal(hostKeyType(Buffer.alloc(2)), "");
});

// ---- known_hosts ----

test("parseKnownHosts: parses entries, skips comments and @markers", () => {
  const content = [
    "# a comment",
    "example.com ssh-ed25519 AAAABASE64",
    "@revoked bad.com ssh-rsa AAAAX",
    "[srv.example.com]:2222 ssh-ed25519 AAAAPORTKEY",
  ].join("\n");
  const entries = parseKnownHosts(content);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].patterns, ["example.com"]);
  assert.equal(entries[0].keyType, "ssh-ed25519");
  assert.equal(entries[0].keyBase64, "AAAABASE64");
});

test("hostToken: bare host for 22, bracketed for other ports", () => {
  assert.equal(hostToken("h", 22), "h");
  assert.equal(hostToken("h", 2222), "[h]:2222");
});

test("checkKnownHosts: match / mismatch / absent by host and key type", () => {
  const entries = parseKnownHosts("example.com ssh-ed25519 GOODKEY");
  assert.equal(
    checkKnownHosts(entries, "example.com", 22, "ssh-ed25519", "GOODKEY").status,
    "match",
  );
  assert.equal(
    checkKnownHosts(entries, "example.com", 22, "ssh-ed25519", "OTHERKEY").status,
    "mismatch",
  );
  // different host -> absent
  assert.equal(
    checkKnownHosts(entries, "other.com", 22, "ssh-ed25519", "GOODKEY").status,
    "absent",
  );
  // same host, different key type -> absent (server switched algorithms)
  assert.equal(
    checkKnownHosts(entries, "example.com", 22, "ssh-rsa", "GOODKEY").status,
    "absent",
  );
});

test("checkKnownHosts: matches a hashed (|1|) host entry", () => {
  const salt = Buffer.from("0123456789abcdef0123", "utf8"); // 20 bytes
  const token = "secret.example.com";
  const mac = createHmac("sha1", salt).update(token).digest("base64");
  const line = `|1|${salt.toString("base64")}|${mac} ssh-ed25519 HASHEDKEY`;
  const entries = parseKnownHosts(line);
  assert.equal(
    checkKnownHosts(entries, "secret.example.com", 22, "ssh-ed25519", "HASHEDKEY").status,
    "match",
  );
  assert.equal(
    checkKnownHosts(entries, "other.example.com", 22, "ssh-ed25519", "HASHEDKEY").status,
    "absent",
  );
});

test("hostKeyFingerprint still stable", () => {
  assert.match(hostKeyFingerprint(Buffer.from("x")), /^SHA256:[A-Za-z0-9+/]+$/);
});
