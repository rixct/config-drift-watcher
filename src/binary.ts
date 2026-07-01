/**
 * Heuristic binary-file detection: a NUL byte within the first chunk of the
 * file. This is the same cheap test git uses — text config files never contain
 * NUL, while binaries almost always do near the start.
 */
export function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
