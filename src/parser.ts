import { ParsedBlock } from "./types";

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

/**
 * Parse the inner source of a ```drift code block.
 *
 * The first non-empty line must be `target: alias:/remote/path`. Every line
 * after it is the documented content (the body), preserved verbatim.
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

  const body = lines.slice(targetLineIndex + 1).join("\n");

  return { alias, remotePath, body, targetLineIndex };
}
