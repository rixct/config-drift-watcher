import { App, PluginSettingTab, Setting } from "obsidian";
import type ConfigDriftWatcherPlugin from "./main";
import { ServerProfile } from "./types";

function emptyProfile(): ServerProfile {
  return {
    alias: "",
    host: "",
    port: 22,
    username: "root",
    privateKeyPath: "~/.ssh/id_ed25519",
  };
}

export class ConfigDriftSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: ConfigDriftWatcherPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const s = this.plugin.settings;

    new Setting(containerEl).setName("Comparison").setHeading();

    new Setting(containerEl)
      .setName("Ignore whitespace")
      .setDesc("Treat whitespace-only differences as in sync.")
      .addToggle((t) =>
        t.setValue(s.ignoreWhitespace).onChange(async (v) => {
          s.ignoreWhitespace = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Ignore comments")
      .setDesc("Drop comment-only lines (per the prefixes below) before diffing.")
      .addToggle((t) =>
        t.setValue(s.ignoreComments).onChange(async (v) => {
          s.ignoreComments = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Comment prefixes")
      .setDesc("Whitespace-separated. A line starting with any of these is a comment.")
      .addText((t) =>
        t
          .setPlaceholder("# ; //")
          .setValue(s.commentPrefixes)
          .onChange(async (v) => {
            s.commentPrefixes = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Connection timeout (ms)")
      .setDesc("How long to wait for the SSH connection before giving up.")
      .addText((t) =>
        t.setValue(String(s.connectTimeoutMs)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            s.connectTimeoutMs = Math.floor(n);
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl).setName("Server profiles").setHeading();

    const intro = containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Each alias is referenced from a note as target: alias:/path. " +
        "Credentials stay here and are never written into a note.",
    });
    intro.style.marginTop = "0";

    s.profiles.forEach((profile, index) => {
      this.renderProfile(containerEl, profile, index);
    });

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("Add server profile")
        .setCta()
        .onClick(async () => {
          s.profiles.push(emptyProfile());
          await this.plugin.saveSettings();
          this.display();
        }),
    );
  }

  private renderProfile(
    containerEl: HTMLElement,
    profile: ServerProfile,
    index: number,
  ): void {
    const box = containerEl.createDiv({ cls: "cdw-profile" });

    new Setting(box)
      .setName(profile.alias ? profile.alias : `Profile ${index + 1}`)
      .setDesc(
        profile.host
          ? `${profile.username}@${profile.host}:${profile.port}`
          : "Not configured yet",
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Remove this profile")
          .onClick(async () => {
            this.plugin.settings.profiles.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const save = async () => this.plugin.saveSettings();

    new Setting(box).setName("Alias").addText((t) =>
      t
        .setPlaceholder("gammastack-stfox")
        .setValue(profile.alias)
        .onChange(async (v) => {
          profile.alias = v.trim();
          await save();
        }),
    );

    new Setting(box).setName("Host").addText((t) =>
      t
        .setPlaceholder("203.0.113.10 or host.example.com")
        .setValue(profile.host)
        .onChange(async (v) => {
          profile.host = v.trim();
          await save();
        }),
    );

    new Setting(box).setName("Port").addText((t) =>
      t.setValue(String(profile.port)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          profile.port = Math.floor(n);
          await save();
        }
      }),
    );

    new Setting(box).setName("Username").addText((t) =>
      t.setValue(profile.username).onChange(async (v) => {
        profile.username = v.trim();
        await save();
      }),
    );

    new Setting(box)
      .setName("Private key path")
      .setDesc("Path on this machine. ~ is expanded to your home directory.")
      .addText((t) =>
        t
          .setPlaceholder("~/.ssh/id_ed25519")
          .setValue(profile.privateKeyPath)
          .onChange(async (v) => {
            profile.privateKeyPath = v.trim();
            await save();
          }),
      );

    new Setting(box)
      .setName("Key passphrase")
      .setDesc("Only if the private key is encrypted. Left in plugin data, not in notes.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(profile.passphrase ?? "").onChange(async (v) => {
          profile.passphrase = v ? v : undefined;
          await save();
        });
      });

    new Setting(box)
      .setName("Host key fingerprint")
      .setDesc(
        "SHA-256 host key. Empty = trust on first use, then pinned automatically. " +
          "Paste a known fingerprint to pin strictly. Forget to re-learn on next connect.",
      )
      .addText((t) =>
        t
          .setPlaceholder("SHA256:…")
          .setValue(profile.hostFingerprint ?? "")
          .onChange(async (v) => {
            profile.hostFingerprint = v.trim() ? v.trim() : undefined;
            await save();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("x")
          .setTooltip("Forget host key (re-learn on next connection)")
          .setDisabled(!profile.hostFingerprint)
          .onClick(async () => {
            profile.hostFingerprint = undefined;
            await save();
            this.display();
          }),
      );
  }
}
