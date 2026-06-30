import { Plugin } from "obsidian";
import { DriftSettings, DEFAULT_SETTINGS } from "./types";
import { ConfigDriftSettingTab } from "./settings";
import { renderDriftBlock } from "./ui/driftBlock";

export default class ConfigDriftWatcherPlugin extends Plugin {
  settings: DriftSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor("drift", (source, el, ctx) => {
      renderDriftBlock(this, source, el, ctx);
    });

    this.addSettingTab(new ConfigDriftSettingTab(this.app, this));

    this.addCommand({
      id: "open-config-drift-settings",
      name: "Open Config Drift Watcher settings",
      callback: () => {
        // Opens Obsidian settings on this plugin's tab.
        const setting = (this.app as unknown as {
          setting: { open: () => void; openTabById: (id: string) => void };
        }).setting;
        setting.open();
        setting.openTabById(this.manifest.id);
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
