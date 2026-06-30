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
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<DriftSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
