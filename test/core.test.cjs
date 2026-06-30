// Unit tests for the pure core modules (parser + diff). No Obsidian, no SSH.
// Run with: npm test  (compiles src to .test-build first, then runs this file).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDriftBlock, BlockParseError } = require("../.test-build/parser.js");
const { computeDrift, parseCommentPrefixes } = require("../.test-build/diff.js");
const { spliceBlockBody } = require("../.test-build/snapshot.js");

const noIgnore = {
  ignoreWhitespace: false,
  ignoreComments: false,
  commentPrefixes: [],
};

test("parser: extracts alias, path and body", () => {
  const block = parseDriftBlock(
    "target: gammastack-stfox:/etc/network/interfaces\nauto eth0\niface eth0 inet dhcp",
  );
  assert.equal(block.alias, "gammastack-stfox");
  assert.equal(block.remotePath, "/etc/network/interfaces");
  assert.equal(block.body, "auto eth0\niface eth0 inet dhcp");
  assert.equal(block.targetLineIndex, 0);
});

test("parser: tolerates leading blank lines and extra spacing", () => {
  const block = parseDriftBlock("\n\n  target:  srv:/etc/hosts  \nline1");
  assert.equal(block.alias, "srv");
  assert.equal(block.remotePath, "/etc/hosts");
  assert.equal(block.targetLineIndex, 2);
  assert.equal(block.body, "line1");
});

test("parser: empty body is allowed", () => {
  const block = parseDriftBlock("target: srv:/etc/hosts");
  assert.equal(block.body, "");
});

test("parser: rejects empty block", () => {
  assert.throws(() => parseDriftBlock("\n   \n"), BlockParseError);
});

test("parser: rejects missing target keyword", () => {
  assert.throws(() => parseDriftBlock("server: srv:/etc/hosts"), BlockParseError);
});

test("parser: rejects target without a path", () => {
  assert.throws(() => parseDriftBlock("target: srvonly"), BlockParseError);
});

test("diff: identical content is in sync", () => {
  const r = computeDrift("a\nb\nc", "a\nb\nc", noIgnore);
  assert.equal(r.inSync, true);
  assert.equal(r.onlyInNote, 0);
  assert.equal(r.onlyOnServer, 0);
});

test("diff: trailing newline on server alone is not drift", () => {
  const r = computeDrift("a\nb", "a\nb\n", noIgnore);
  assert.equal(r.inSync, true);
});

test("diff: counts added and removed lines", () => {
  const r = computeDrift("a\nx\nc", "a\ny\nc", noIgnore);
  assert.equal(r.inSync, false);
  assert.equal(r.onlyInNote, 1);
  assert.equal(r.onlyOnServer, 1);
  const removed = r.lines.filter((l) => l.type === "removed").map((l) => l.value);
  const added = r.lines.filter((l) => l.type === "added").map((l) => l.value);
  assert.deepEqual(removed, ["x"]);
  assert.deepEqual(added, ["y"]);
});

test("diff: ignoreWhitespace hides whitespace-only changes", () => {
  const withWs = computeDrift("a\n  b", "a\nb", noIgnore);
  assert.equal(withWs.inSync, false);
  const ignoringWs = computeDrift("a\n  b", "a\nb", {
    ...noIgnore,
    ignoreWhitespace: true,
  });
  assert.equal(ignoringWs.inSync, true);
});

test("diff: ignoreComments drops comment-only lines on both sides", () => {
  const note = "# documented\nlisten 80;";
  const remote = "# changed comment\nlisten 80;\n# extra";
  const strict = computeDrift(note, remote, noIgnore);
  assert.equal(strict.inSync, false);
  const lenient = computeDrift(note, remote, {
    ...noIgnore,
    ignoreComments: true,
    commentPrefixes: ["#"],
  });
  assert.equal(lenient.inSync, true);
});

test("parseCommentPrefixes splits on whitespace", () => {
  assert.deepEqual(parseCommentPrefixes("# ; //"), ["#", ";", "//"]);
  assert.deepEqual(parseCommentPrefixes("   "), []);
});

test("snapshot: replaces block body, keeps fences and surrounding note", () => {
  const note = [
    "# Note",
    "",
    "```drift",
    "target: srv:/etc/hosts",
    "old line",
    "```",
    "",
    "after",
  ].join("\n");
  // lineStart = 2 (```drift), lineEnd = 5 (closing ```), targetLineIndex = 0
  const out = spliceBlockBody(note, 2, 5, 0, "new1\nnew2\n");
  assert.equal(
    out,
    [
      "# Note",
      "",
      "```drift",
      "target: srv:/etc/hosts",
      "new1",
      "new2",
      "```",
      "",
      "after",
    ].join("\n"),
  );
});

test("snapshot: fills an empty block body", () => {
  const note = ["```drift", "target: srv:/x", "```"].join("\n");
  // inner = ["target: srv:/x"], targetLineIndex = 0, lineStart=0, lineEnd=2
  const out = spliceBlockBody(note, 0, 2, 0, "a\nb");
  assert.equal(
    out,
    ["```drift", "target: srv:/x", "a", "b", "```"].join("\n"),
  );
});
