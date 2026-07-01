import { DiffLine } from "./types";

export type CollapsedRow =
  | { kind: "line"; line: DiffLine }
  | { kind: "gap"; hidden: DiffLine[] };

/**
 * Collapse long runs of unchanged (context) lines into gaps, keeping only
 * `context` lines of context around each change — a git-style hunk view.
 *
 * Changed lines and the lines within `context` of them are kept; everything
 * else is bundled into a gap so the caller can render an expandable
 * "N unchanged lines" placeholder.
 */
export function collapseDiff(lines: DiffLine[], context: number): CollapsedRow[] {
  const n = lines.length;
  const keep = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    if (lines[i].type !== "context") {
      const from = Math.max(0, i - context);
      const to = Math.min(n - 1, i + context);
      for (let j = from; j <= to; j++) keep[j] = true;
    }
  }

  const rows: CollapsedRow[] = [];
  let i = 0;
  while (i < n) {
    if (keep[i]) {
      rows.push({ kind: "line", line: lines[i] });
      i++;
    } else {
      const hidden: DiffLine[] = [];
      while (i < n && !keep[i]) {
        hidden.push(lines[i]);
        i++;
      }
      rows.push({ kind: "gap", hidden });
    }
  }
  return rows;
}
