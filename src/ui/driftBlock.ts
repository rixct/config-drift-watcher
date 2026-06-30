import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import type ConfigDriftWatcherPlugin from "../main";
import { parseDriftBlock, BlockParseError } from "../parser";
import { computeDrift, parseCommentPrefixes } from "../diff";
import { readRemoteFile, RemoteReadError } from "../sftp";
import { spliceBlockBody } from "../snapshot";
import { DriftResult, ParsedBlock, ServerProfile } from "../types";

type BadgeState = "unknown" | "checking" | "synced" | "drift" | "error";

function findProfile(
  plugin: ConfigDriftWatcherPlugin,
  alias: string,
): ServerProfile | undefined {
  return plugin.settings.profiles.find((p) => p.alias === alias);
}

function setBadge(badgeEl: HTMLElement, state: BadgeState, text: string): void {
  badgeEl.className = "cdw-badge is-" + state;
  badgeEl.setText(text);
}

/** Entry point registered as the `drift` code block processor. */
export function renderDriftBlock(
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
    const badge = root.createDiv();
    setBadge(badge, "error", "⛔ invalid block");
    root.createEl("p", { cls: "cdw-error", text: message });
    return;
  }

  // Caption: which server/file this block documents.
  root.createDiv({
    cls: "cdw-target",
    text: `${parsed.alias}:${parsed.remotePath}`,
  });

  // The documented content, rendered as a read-only code block.
  const pre = root.createEl("pre", { cls: "cdw-doc" });
  pre.createEl("code", { text: parsed.body });

  // Toolbar: status badge + actions.
  const toolbar = root.createDiv({ cls: "cdw-toolbar" });
  const badge = toolbar.createDiv();
  setBadge(badge, "unknown", "❓ not checked");

  const checkBtn = toolbar.createEl("button", { cls: "cdw-btn" });
  checkBtn.createSpan({ text: "Check drift" });
  const snapshotBtn = toolbar.createEl("button", { cls: "cdw-btn" });
  snapshotBtn.createSpan({ text: "Snapshot from server" });

  const diffEl = root.createDiv({ cls: "cdw-diff" });
  diffEl.hide();

  const setBusy = (busy: boolean) => {
    checkBtn.disabled = busy;
    snapshotBtn.disabled = busy;
  };

  const resolveProfileOrWarn = (): ServerProfile | null => {
    const profile = findProfile(plugin, parsed.alias);
    if (!profile) {
      setBadge(badge, "error", "⛔ unknown alias");
      diffEl.empty();
      diffEl.show();
      diffEl.createEl("p", {
        cls: "cdw-error",
        text: `No server profile named "${parsed.alias}". Add it in plugin settings.`,
      });
    }
    return profile ?? null;
  };

  checkBtn.onclick = async () => {
    const profile = resolveProfileOrWarn();
    if (!profile) return;
    setBusy(true);
    setBadge(badge, "checking", "… checking");
    diffEl.empty();
    diffEl.hide();
    try {
      const remote = await readRemoteFile(
        profile,
        parsed.remotePath,
        plugin.settings.connectTimeoutMs,
      );
      const result = computeDrift(parsed.body, remote, {
        ignoreWhitespace: plugin.settings.ignoreWhitespace,
        ignoreComments: plugin.settings.ignoreComments,
        commentPrefixes: parseCommentPrefixes(plugin.settings.commentPrefixes),
      });
      renderResult(badge, diffEl, result);
    } catch (e) {
      const message = e instanceof RemoteReadError ? e.message : String(e);
      setBadge(badge, "error", "⛔ error");
      diffEl.empty();
      diffEl.show();
      diffEl.createEl("p", { cls: "cdw-error", text: message });
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
    setBadge(badge, "checking", "… reading");
    try {
      const remote = await readRemoteFile(
        profile,
        parsed.remotePath,
        plugin.settings.connectTimeoutMs,
      );
      await writeSnapshot(plugin, parsed, el, ctx, remote);
      new Notice(`Snapshot captured from ${parsed.alias}:${parsed.remotePath}`);
      // The note change triggers a re-render of this block automatically.
    } catch (e) {
      const message = e instanceof RemoteReadError ? e.message : String(e);
      setBadge(badge, "error", "⛔ error");
      diffEl.empty();
      diffEl.show();
      diffEl.createEl("p", { cls: "cdw-error", text: message });
    } finally {
      setBusy(false);
    }
  };
}

function renderResult(
  badge: HTMLElement,
  diffEl: HTMLElement,
  result: DriftResult,
): void {
  if (result.inSync) {
    setBadge(badge, "synced", "✅ in sync");
    diffEl.empty();
    diffEl.hide();
    return;
  }

  const changed = result.onlyInNote + result.onlyOnServer;
  setBadge(badge, "drift", `⚠️ drift: ${changed} line${changed === 1 ? "" : "s"}`);

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
  for (const line of result.lines) {
    const row = body.createDiv({ cls: "cdw-diff-line " + line.type });
    const prefix = line.type === "added" ? "+" : line.type === "removed" ? "−" : " ";
    row.createSpan({ cls: "cdw-gutter", text: prefix });
    row.createSpan({ cls: "cdw-content", text: line.value });
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
    parsed.targetLineIndex,
    remote,
  );
  await plugin.app.vault.modify(file, newContent);
}
