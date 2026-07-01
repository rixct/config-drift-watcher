import { IgnoreOverride, ParsedBlock } from "./types";

/** Thrown when a `drift` block is missing or has a malformed target line. */
export class BlockParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockParseError";
  }
}

// `target: <alias>:<absolute/path>`. The alias has no colon or whitespace;
// everything after the first colon following the alias is the remote path.
const TARGET_RE = /^target:\s*([^\s:]+):(.+)$/;
// Optional header directive: `ignore: whitespace comments`.
const IGNORE_RE = /^ignore\s*:\s*(.*)$/i;

/** Parse the value of an `ignore:` directive into flags. */
function parseIgnore(value: string): IgnoreOverride {
  const tokens = value.toLowerCase().split(/[\s,]+/).filter((t) => t !== "");
  const ignore: IgnoreOverride = { whitespace: false, comments: false };
  for (const t of tokens) {
    if (t === "whitespace" || t === "ws") ignore.whitespace = true;
    else if (t === "comments" || t === "comment") ignore.comments = true;
    else if (t === "none") {
      ignore.whitespace = false;
      ignore.comments = false;
    }
    // unknown tokens are ignored
  }
  return ignore;
}

/**
 * Parse the inner source of a ```drift code block.
 *
 * The first non-empty line must be `target: alias:/remote/path`. It may be
 * followed by optional `ignore:` directive lines. Everything after the header
 * is the documented content (the body), preserved verbatim.
 */
export function parseDriftBlock(source: string): ParsedBlock {
  const lines = source.split("\n");

  let targetLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "") {
      targetLineIndex = i;
      break;
    }
  }

  if (targetLineIndex === -1) {
    throw new BlockParseError(
      "Empty drift block. Expected a first line like: target: myserver:/etc/nginx/nginx.conf",
    );
  }

  const match = TARGET_RE.exec(lines[targetLineIndex].trim());
  if (!match) {
    throw new BlockParseError(
      `Malformed target line: "${lines[targetLineIndex].trim()}". ` +
        "Expected: target: alias:/absolute/remote/path",
    );
  }

  const alias = match[1].trim();
  const remotePath = match[2].trim();

  if (!alias) {
    throw new BlockParseError("Target is missing a server alias.");
  }
  if (!remotePath) {
    throw new BlockParseError("Target is missing a remote file path.");
  }

  // Consume optional `ignore:` directive lines immediately after the target.
  let ignore: IgnoreOverride | undefined;
  let bodyStartIndex = targetLineIndex + 1;
  for (let i = targetLineIndex + 1; i < lines.length; i++) {
    const m = IGNORE_RE.exec(lines[i].trim());
    if (!m) break;
    ignore = parseIgnore(m[1]);
    bodyStartIndex = i + 1;
  }

  const body = lines.slice(bodyStartIndex).join("\n");

  return { alias, remotePath, body, bodyStartIndex, ignore };
}
