// Shared types for Config Drift Watcher.

/** A reusable SSH connection profile. Credentials live here, never in a note. */
export interface ServerProfile {
  /** Alias referenced from a note, e.g. "gammastack-stfox". */
  alias: string;
  host: string;
  port: number;
  username: string;
  /** Absolute or ~-relative path to a private key on this machine. */
  privateKeyPath: string;
  /** Optional passphrase if the private key is encrypted. */
  passphrase?: string;
  /**
   * Pinned SHA-256 host key fingerprint (e.g. "SHA256:...").
   * Empty = trust on first use, then pin automatically.
   */
  hostFingerprint?: string;
}

export interface DriftSettings {
  profiles: ServerProfile[];
  /** Ignore whitespace-only differences when diffing. */
  ignoreWhitespace: boolean;
  /** Drop comment-only lines (per commentPrefixes) before diffing. */
  ignoreComments: boolean;
  /** Whitespace-separated comment prefixes, e.g. "# ; //". */
  commentPrefixes: string;
  /** SSH connection timeout in milliseconds. */
  connectTimeoutMs: number;
  /** Collapse long runs of unchanged lines in the inline diff. */
  collapseUnchanged: boolean;
  /** Context lines kept around each change when collapsing. */
  diffContextLines: number;
  /** Verify the server host key against ~/.ssh/known_hosts before pin/TOFU. */
  useKnownHosts: boolean;
}

export const DEFAULT_SETTINGS: DriftSettings = {
  profiles: [],
  ignoreWhitespace: false,
  ignoreComments: false,
  commentPrefixes: "# ; //",
  connectTimeoutMs: 15000,
  collapseUnchanged: true,
  diffContextLines: 3,
  useKnownHosts: true,
};

/** Per-block ignore overrides parsed from an `ignore:` directive. */
export interface IgnoreOverride {
  whitespace: boolean;
  comments: boolean;
}

/** Result of parsing a `drift` code block. */
export interface ParsedBlock {
  alias: string;
  remotePath: string;
  /** The documented content (everything after the header). */
  body: string;
  /** Index within the block's inner lines where the body begins. */
  bodyStartIndex: number;
  /** Per-block ignore override from an `ignore:` directive, if present. */
  ignore?: IgnoreOverride;
}

export type DiffLineType = "context" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  value: string;
}

export interface DriftResult {
  inSync: boolean;
  /** Lines present in the note but not on the server. */
  onlyInNote: number;
  /** Lines present on the server but not in the note. */
  onlyOnServer: number;
  lines: DiffLine[];
}
