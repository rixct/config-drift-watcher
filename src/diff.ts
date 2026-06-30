import { diffLines } from "diff";
import { DiffLine, DriftResult } from "./types";

export interface DiffOptions {
  ignoreWhitespace: boolean;
  ignoreComments: boolean;
  /** Comment prefixes; a line whose trimmed start matches one is comment-only. */
  commentPrefixes: string[];
}

/** Strip a single trailing newline — the conventional final newline of a file,
 *  which the code-block body never has and which would otherwise read as drift. */
function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function isCommentLine(line: string, prefixes: string[]): boolean {
  const trimmed = line.trimStart();
  if (trimmed === "") return false;
  return prefixes.some((p) => p !== "" && trimmed.startsWith(p));
}

function dropCommentLines(text: string, prefixes: string[]): string {
  return text
    .split("\n")
    .filter((line) => !isCommentLine(line, prefixes))
    .join("\n");
}

/** Expand a diff part's value into individual lines, dropping the artifact
 *  empty string produced by the part's terminating newline. */
function expandLines(value: string): string[] {
  const parts = value.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

/**
 * Compare the documented note content against the actual remote content,
 * line by line. Pure text diff — no awareness of any config format.
 */
export function computeDrift(
  noteText: string,
  remoteText: string,
  opts: DiffOptions,
): DriftResult {
  let a = stripTrailingNewline(noteText);
  let b = stripTrailingNewline(remoteText);

  if (opts.ignoreComments) {
    a = dropCommentLines(a, opts.commentPrefixes);
    b = dropCommentLines(b, opts.commentPrefixes);
  }

  const parts = diffLines(a, b, {
    ignoreWhitespace: opts.ignoreWhitespace,
    newlineIsToken: false,
  });

  const lines: DiffLine[] = [];
  let onlyInNote = 0;
  let onlyOnServer = 0;

  for (const part of parts) {
    const type = part.added ? "added" : part.removed ? "removed" : "context";
    for (const value of expandLines(part.value)) {
      lines.push({ type, value });
      if (type === "added") onlyOnServer++;
      else if (type === "removed") onlyInNote++;
    }
  }

  return {
    inSync: onlyInNote === 0 && onlyOnServer === 0,
    onlyInNote,
    onlyOnServer,
    lines,
  };
}

/** Parse the settings string of comment prefixes into a trimmed array. */
export function parseCommentPrefixes(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}
