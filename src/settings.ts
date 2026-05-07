import { App, PluginSettingTab, Setting } from "obsidian";
import type CopyNotesPlugin from "./main";

export interface CopyNotesSettings {
	lastDestinationVault: string;
	includeAttachments: boolean;
	preserveFolderStructure: boolean;
}

export const DEFAULT_SETTINGS: CopyNotesSettings = {
	lastDestinationVault: "",
	includeAttachments: true,
	preserveFolderStructure: true,
};

export class CopyNotesSettingTab extends PluginSettingTab {
	plugin: CopyNotesPlugin;

	constructor(app: App, plugin: CopyNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default destination vault")
			.setDesc("Pre-filled path when opening the copy dialog.")
			.addText((text) =>
				text
					.setPlaceholder("/path/to/vault")
					.setValue(this.plugin.settings.lastDestinationVault)
					.onChange(async (value) => {
						this.plugin.settings.lastDestinationVault = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include attachments by default")
			.setDesc("Also copy images, pdfs, videos, and other files referenced in selected notes.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeAttachments)
					.onChange(async (value) => {
						this.plugin.settings.includeAttachments = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Preserve folder structure by default")
			.setDesc("Recreate the source folder hierarchy inside the destination vault.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.preserveFolderStructure)
					.onChange(async (value) => {
						this.plugin.settings.preserveFolderStructure = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
