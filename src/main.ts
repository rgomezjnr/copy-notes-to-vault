import { Plugin } from "obsidian";
import { CopyNotesSettings, DEFAULT_SETTINGS, CopyNotesSettingTab } from "./settings";
import { CopyNotesModal } from "./modal";

export default class CopyNotesPlugin extends Plugin {
	settings!: CopyNotesSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("copy", "Copy Notes to Another Vault", () => {
			new CopyNotesModal(this.app, this).open();
		});

		this.addCommand({
			id: "open-copy-notes-modal",
			name: "Copy notes to another vault",
			callback: () => new CopyNotesModal(this.app, this).open(),
		});

		this.addSettingTab(new CopyNotesSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
