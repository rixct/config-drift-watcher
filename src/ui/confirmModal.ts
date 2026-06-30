import { App, Modal, Setting } from "obsidian";

/**
 * A small yes/no modal. Resolves true if the user confirms, false otherwise
 * (including closing the modal). Used to guard Snapshot from silently
 * overwriting a manually documented (intended) state.
 */
export class ConfirmModal extends Modal {
  private resolved = false;
  private resolve!: (value: boolean) => void;

  constructor(
    app: App,
    private titleText: string,
    private bodyText: string,
    private confirmText = "Overwrite",
  ) {
    super(app);
  }

  openAndConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.bodyText });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => {
            this.resolved = true;
            this.resolve(true);
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }
}
