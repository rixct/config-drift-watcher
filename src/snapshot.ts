/** Strip a single trailing newline (the conventional final newline of a file). */
function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

/**
 * Produce the new note content after replacing a drift block's body with the
 * remote file content, preserving the fences and the target line.
 *
 * `lineStart` / `lineEnd` are the document line indices of the opening and
 * closing ``` fences (as given by Obsidian's getSectionInfo). `targetLineIndex`
 * is the index of the target line within the block's inner lines.
 */
export function spliceBlockBody(
  fileContent: string,
  lineStart: number,
  lineEnd: number,
  targetLineIndex: number,
  remote: string,
): string {
  const fileLines = fileContent.split("\n");

  const innerStart = lineStart + 1; // first line after the opening fence
  const inner = fileLines.slice(innerStart, lineEnd); // inner content, no fences
  const header = inner.slice(0, targetLineIndex + 1); // keep target (+ any preamble)
  const remoteBody = stripTrailingNewline(remote).split("\n");

  const newInner = [...header, ...remoteBody];
  return [
    ...fileLines.slice(0, innerStart),
    ...newInner,
    ...fileLines.slice(lineEnd),
  ].join("\n");
}
