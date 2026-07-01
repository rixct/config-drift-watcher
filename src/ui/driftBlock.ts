import { MarkdownPostProcessorContext, Notice, TFile, setIcon } from "obsidian";
import type ConfigDriftWatcherPlugin from "../main";
import { parseDriftBlock, BlockParseError } from "../parser";
import { computeDrift, parseCommentPrefixes } from "../diff";
import { readRemoteFile, RemoteReadError } from "../sftp";
import { spliceBlockBody } from "../snapshot";
import { collapseDiff } from "../collapse";
import { DiffLine, DriftResult, ParsedBlock, ServerProfile } from "../types";

const KNOWN_HOSTS_PATH = "~/.ssh/known_hosts";

type BadgeState = "unknown" | "checking" | "synced" | "drift" | "error";

const BADGE_ICON: Record<BadgeState, string> = {
  unknown: "help-circle",
  checking: "refresh-cw",
  synced: "check-circle",
  drift: "alert-triangle",
  error: "x-circle",
};

function findProfile(
  plugin: ConfigDriftWatcherPlugin,
  alias: string,
): ServerProfile | undefined {
  return plugin.settings.profiles.find((p) => p.alias === alias);
}

/**
 * Read a remote file, verifying the host key. On the first successful
 * connection to a profile with no pinned fingerprint, the fingerprint is
 * learned and saved (trust on first use), so later connections are pinned.
 */
async function readRemote(
  plugin: ConfigDriftWatcherPlugin,
  profile: ServerProfile,
  remotePath: string,
): Promise<string> {
  let seenFingerprint: string | null = null;
  const content = await readRemoteFile(profile, remotePath, {
    timeoutMs: plugin.settings.connectTimeoutMs,
    expectedFingerprint: profile.hostFingerprint,
    knownHostsPath: plugin.settings.useKnownHosts ? KNOWN_HOSTS_PATH : undefined,
    onHostKey: (fp) => {
      seenFingerprint = fp;
    },
  });
  if (!profile.hostFingerprint && seenFingerprint) {
    profile.hostFingerprint = seenFingerprint;
    await plugin.saveSettings();
    new Notice(`Trusted host key for ${profile.alias}:\n${seenFingerprint}`);
  }
  return content;
}

/** Render a status pill: a lucide icon plus a readable text label. */
function setBadge(badgeEl: HTMLElement, state: BadgeState, text: string): void {
  badgeEl.className = "cdw-badge is-" + state;
  badgeEl.empty();
  const icon = badgeEl.createSpan({ cls: "cdw-badge-icon" });
  setIcon(icon, BADGE_ICON[state]);
  badgeEl.createSpan({ cls: "cdw-badge-text", text });
}

function makeButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  primary = false,
): HTMLButtonElement {
  const btn = parent.createEl("button", {
    cls: "cdw-btn" + (primary ? " mod-cta" : ""),
  });
  setIcon(btn.createSpan({ cls: "cdw-btn-icon" }), icon);
  btn.createSpan({ text: label });
  return btn;
}

/** Entry point registered as the `drift` code block processor. Runs in both
 *  reading view and live preview. Wrapped so any failure shows a visible error
 *  instead of letting Obsidian fall back to rendering the raw code block. */
export function renderDriftBlock(
  plugin: ConfigDriftWatcherPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  try {
    render(plugin, source, el, ctx);
  } catch (e) {
    el.empty();
    const root = el.createDiv({ cls: "cdw-block is-error-card" });
    const header = root.createDiv({ cls: "cdw-header" });
    const badge = header.createDiv();
    setBadge(badge, "error", "Render error");
    root.createDiv({
      cls: "cdw-message cdw-error",
      text: e instanceof Error ? e.message : String(e),
    });
  }
}

function render(
  plugin: ConfigDriftWatcherPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  el.empty();
  const root = el.createDiv({ cls: "cdw-block" });

  let parsed: ParsedBlock;
  try {
    parsed = parseDriftBlock(source);
  } catch (e) {
    const message = e instanceof BlockParseError ? e.message : String(e);
    const header = root.createDiv({ cls: "cdw-header" });
    const badge = header.createDiv();
    setBadge(badge, "error", "Invalid block");
    root.createDiv({ cls: "cdw-message cdw-error", text: message });
    return;
  }

  // Header: which server/file this block documents.
  const header = root.createDiv({ cls: "cdw-header" });
  setIcon(header.createSpan({ cls: "cdw-header-icon" }), "server");
  header.createSpan({
    cls: "cdw-target",
    text: `${parsed.alias}:${parsed.remotePath}`,
  });

  // The documented content, rendered as a read-only code block.
  const pre = root.createEl("pre", { cls: "cdw-doc" });
  if (parsed.body.trim() === "") {
    pre.createEl("code", {
      cls: "cdw-doc-empty",
      text: "(empty — use “Snapshot from server” to capture a baseline)",
    });
  } else {
    pre.createEl("code", { text: parsed.body });
  }

  // Toolbar: status badge on the left, actions on the right.
  const toolbar = root.createDiv({ cls: "cdw-toolbar" });
  const badge = toolbar.createDiv();
  setBadge(badge, "unknown", "Not checked");
  toolbar.createDiv({ cls: "cdw-spacer" });
  const checkBtn = makeButton(toolbar, "refresh-cw", "Check drift", true);
  const snapshotBtn = makeButton(toolbar, "download", "Snapshot from server");

  const diffEl = root.createDiv({ cls: "cdw-diff" });
  diffEl.hide();

  const setBusy = (busy: boolean) => {
    checkBtn.disabled = busy;
    snapshotBtn.disabled = busy;
  };

  const showError = (message: string) => {
    setBadge(badge, "error", "Error");
    diffEl.empty();
    diffEl.show();
    diffEl.createDiv({ cls: "cdw-message cdw-error", text: message });
  };

  const resolveProfileOrWarn = (): ServerProfile | null => {
    const profile = findProfile(plugin, parsed.alias);
    if (!profile) {
      setBadge(badge, "error", "Unknown alias");
      diffEl.empty();
      diffEl.show();
      diffEl.createDiv({
        cls: "cdw-message cdw-error",
        text: `No server profile named "${parsed.alias}". Add it in plugin settings.`,
      });
    }
    return profile ?? null;
  };

  checkBtn.onclick = async () => {
    const profile = resolveProfileOrWarn();
    if (!profile) return;
    setBusy(true);
    setBadge(badge, "checking", "Checking…");
    diffEl.empty();
    diffEl.hide();
    try {
      const remote = await readRemote(plugin, profile, parsed.remotePath);
      const ig = parsed.ignore;
      const result = computeDrift(parsed.body, remote, {
        ignoreWhitespace: ig ? ig.whitespace : plugin.settings.ignoreWhitespace,
        ignoreComments: ig ? ig.comments : plugin.settings.ignoreComments,
        commentPrefixes: parseCommentPrefixes(plugin.settings.commentPrefixes),
      });
      renderResult(plugin, badge, diffEl, result);
    } catch (e) {
      showError(e instanceof RemoteReadError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  snapshotBtn.onclick = async () => {
    const profile = resolveProfileOrWarn();
    if (!profile) return;

    if (parsed.body.trim() !== "") {
      const { ConfirmModal } = await import("./confirmModal");
      const ok = await new ConfirmModal(
        plugin.app,
        "Overwrite documented content?",
        `This replaces the content of this block with the current state of ` +
          `${parsed.remotePath} on ${parsed.alias}. Any manual edits (an ` +
          `intended future state) will be lost.`,
        "Overwrite",
      ).openAndConfirm();
      if (!ok) return;
    }

    setBusy(true);
    setBadge(badge, "checking", "Reading…");
    try {
      const remote = await readRemote(plugin, profile, parsed.remotePath);
      await writeSnapshot(plugin, parsed, el, ctx, remote);
      new Notice(`Snapshot captured from ${parsed.alias}:${parsed.remotePath}`);
      // The note change triggers a re-render of this block automatically.
    } catch (e) {
      showError(e instanceof RemoteReadError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
}

function renderDiffLine(container: HTMLElement, line: DiffLine, before?: HTMLElement): void {
  const row = container.createDiv({ cls: "cdw-diff-line " + line.type });
  const prefix = line.type === "added" ? "+" : line.type === "removed" ? "−" : " ";
  row.createSpan({ cls: "cdw-gutter", text: prefix });
  row.createSpan({ cls: "cdw-content", text: line.value });
  if (before) container.insertBefore(row, before);
}

function renderResult(
  plugin: ConfigDriftWatcherPlugin,
  badge: HTMLElement,
  diffEl: HTMLElement,
  result: DriftResult,
): void {
  if (result.inSync) {
    setBadge(badge, "synced", "In sync");
    diffEl.empty();
    diffEl.hide();
    return;
  }

  const changed = result.onlyInNote + result.onlyOnServer;
  setBadge(badge, "drift", `Drift · ${changed} line${changed === 1 ? "" : "s"}`);

  diffEl.empty();
  diffEl.show();

  const legend = diffEl.createDiv({ cls: "cdw-legend" });
  legend.createSpan({
    cls: "cdw-legend-item removed",
    text: `− ${result.onlyInNote} only in note`,
  });
  legend.createSpan({
    cls: "cdw-legend-item added",
    text: `+ ${result.onlyOnServer} only on server`,
  });

  const body = diffEl.createDiv({ cls: "cdw-diff-body" });

  if (!plugin.settings.collapseUnchanged) {
    for (const line of result.lines) renderDiffLine(body, line);
    return;
  }

  const context = Math.max(0, plugin.settings.diffContextLines);
  for (const row of collapseDiff(result.lines, context)) {
    if (row.kind === "line") {
      renderDiffLine(body, row.line);
      continue;
    }
    // A collapsed gap: a clickable placeholder that expands its hidden lines.
    const hidden = row.hidden;
    const gap = body.createDiv({ cls: "cdw-diff-gap" });
    const n = hidden.length;
    gap.setText(`\u22ef ${n} unchanged line${n === 1 ? "" : "s"} \u2014 click to expand`);
    gap.onclick = () => {
      for (const line of hidden) renderDiffLine(body, line, gap);
      gap.remove();
    };
  }
}

/** Replace the block body (everything after the target line) with remote content. */
async function writeSnapshot(
  plugin: ConfigDriftWatcherPlugin,
  parsed: ParsedBlock,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  remote: string,
): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) {
    throw new RemoteReadError(`Cannot locate note file: ${ctx.sourcePath}`);
  }

  const sec = ctx.getSectionInfo(el);
  if (!sec) {
    throw new RemoteReadError(
      "Cannot determine this block's position in the note. Try again from reading view.",
    );
  }

  const content = await plugin.app.vault.read(file);
  const newContent = spliceBlockBody(
    content,
    sec.lineStart,
    sec.lineEnd,
    parsed.bodyStartIndex,
    remote,
  );
  await plugin.app.vault.modify(file, newContent);
}
