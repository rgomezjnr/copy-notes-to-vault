import {
	App,
	Modal,
	Notice,
	Setting,
	TFile,
	TFolder,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type CopyNotesPlugin from "./main";
import { getVaultBasePath, ensureDirSync, getAttachmentPaths } from "./utils";

export class CopyNotesModal extends Modal {
	plugin: CopyNotesPlugin;
	private selectedPaths = new Set<string>();
	private destinationVault: string;
	private includeAttachments: boolean;
	private preserveFolderStructure: boolean;
	private searchQuery = "";

	private progressEl!: HTMLElement;
	private copyBtn!: HTMLButtonElement;
	private fileListEl!: HTMLElement;
	private selectedCountEl!: HTMLElement;

	constructor(app: App, plugin: CopyNotesPlugin) {
		super(app);
		this.plugin = plugin;
		this.destinationVault = plugin.settings.lastDestinationVault;
		this.includeAttachments = plugin.settings.includeAttachments;
		this.preserveFolderStructure = plugin.settings.preserveFolderStructure;
	}

	onOpen() {
		this.modalEl.addClass("copy-notes-modal");
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Copy Notes to Another Vault" });

		// ── Top controls ──────────────────────────────────────────────────
		const controls = contentEl.createDiv("copy-notes-controls");

		const searchInput = controls.createEl("input", {
			type: "text",
			placeholder: "Search notes…",
			cls: "copy-notes-search",
		});
		searchInput.addEventListener("input", () => {
			this.searchQuery = searchInput.value.toLowerCase();
			this.renderFileList();
		});

		const selectionBtns = controls.createDiv("copy-notes-selection-btns");
		const selectAllBtn = selectionBtns.createEl("button", { text: "Select all" });
		selectAllBtn.addEventListener("click", () => this.selectAll(true));
		const deselectAllBtn = selectionBtns.createEl("button", { text: "Deselect all" });
		deselectAllBtn.addEventListener("click", () => this.selectAll(false));

		this.selectedCountEl = controls.createDiv("copy-notes-count");
		this.updateSelectedCount();

		// ── File list ─────────────────────────────────────────────────────
		this.fileListEl = contentEl.createDiv("copy-notes-file-list");
		this.renderFileList();

		// ── Options ───────────────────────────────────────────────────────
		const options = contentEl.createDiv("copy-notes-options");

		new Setting(options)
			.setName("Include attachments")
			.setDesc("Also copy images, PDFs, videos, and other files referenced in the selected notes.")
			.addToggle((toggle) =>
				toggle.setValue(this.includeAttachments).onChange((v) => {
					this.includeAttachments = v;
				})
			);

		new Setting(options)
			.setName("Preserve folder structure")
			.setDesc("Recreate the source folder hierarchy inside the destination vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.preserveFolderStructure).onChange((v) => {
					this.preserveFolderStructure = v;
				})
			);

		// ── Destination vault ─────────────────────────────────────────────
		const destSection = contentEl.createDiv("copy-notes-dest");
		destSection.createEl("h3", { text: "Destination vault" });

		const destRow = destSection.createDiv("copy-notes-dest-row");
		const destInput = destRow.createEl("input", {
			type: "text",
			placeholder: "/path/to/destination/vault",
			cls: "copy-notes-dest-input",
			value: this.destinationVault,
		});
		destInput.addEventListener("input", () => {
			this.destinationVault = destInput.value.trim();
		});

		const browseBtn = destRow.createEl("button", { text: "Browse…" });
		browseBtn.addEventListener("click", async () => {
			const chosen = await this.pickFolder();
			if (chosen) {
				this.destinationVault = chosen;
				destInput.value = chosen;
			}
		});

		// ── Footer ────────────────────────────────────────────────────────
		const footer = contentEl.createDiv("copy-notes-footer");
		this.progressEl = footer.createDiv("copy-notes-progress");

		this.copyBtn = footer.createEl("button", {
			text: "Copy notes",
			cls: "mod-cta copy-notes-copy-btn",
		});
		this.copyBtn.addEventListener("click", () => this.runCopy());
	}

	onClose() {
		this.contentEl.empty();
	}

	// ── File-list rendering ───────────────────────────────────────────────

	private renderFileList() {
		this.fileListEl.empty();
		this.renderFolder(this.app.vault.getRoot(), this.fileListEl, 0);
	}

	private renderFolder(folder: TFolder, container: HTMLElement, depth: number) {
		const isRoot = folder.path === "/";

		if (!isRoot) {
			const folderRow = container.createDiv({ cls: "copy-notes-folder-row" });
			folderRow.style.paddingLeft = `${depth * 16}px`;

			const arrow = folderRow.createSpan({ cls: "copy-notes-arrow", text: "▶" });
			folderRow.createSpan({ cls: "copy-notes-folder-icon", text: "📁" });
			folderRow.createSpan({ cls: "copy-notes-folder-name", text: folder.name });

			const childContainer = container.createDiv({ cls: "copy-notes-folder-children" });
			childContainer.style.display = "none";

			arrow.addEventListener("click", () => {
				const collapsed = childContainer.style.display === "none";
				childContainer.style.display = collapsed ? "block" : "none";
				arrow.textContent = collapsed ? "▼" : "▶";
			});

			this.renderFolderContents(folder, childContainer, depth + 1);
		} else {
			this.renderFolderContents(folder, container, depth);
		}
	}

	private renderFolderContents(folder: TFolder, container: HTMLElement, depth: number) {
		const sorted = [...folder.children].sort((a, b) => {
			const aIsFolder = a instanceof TFolder ? 0 : 1;
			const bIsFolder = b instanceof TFolder ? 0 : 1;
			return aIsFolder - bIsFolder || a.name.localeCompare(b.name);
		});

		for (const child of sorted) {
			if (child instanceof TFolder) {
				this.renderFolder(child, container, depth);
			} else if (child instanceof TFile && child.extension === "md") {
				if (this.searchQuery && !child.name.toLowerCase().includes(this.searchQuery)) {
					continue;
				}
				this.renderFileRow(child, container, depth);
			}
		}
	}

	private renderFileRow(file: TFile, container: HTMLElement, depth: number) {
		const row = container.createDiv({ cls: "copy-notes-file-row" });
		row.style.paddingLeft = `${depth * 16}px`;

		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.checked = this.selectedPaths.has(file.path);
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) {
				this.selectedPaths.add(file.path);
			} else {
				this.selectedPaths.delete(file.path);
			}
			this.updateSelectedCount();
		});

		row.createSpan({ cls: "copy-notes-file-icon", text: "📄" });
		row.createSpan({ cls: "copy-notes-file-name", text: file.basename });
		row.createSpan({ cls: "copy-notes-file-path", text: file.parent?.path ?? "" });

		row.addEventListener("click", (e) => {
			if ((e.target as HTMLElement) === checkbox) return;
			checkbox.checked = !checkbox.checked;
			checkbox.dispatchEvent(new Event("change"));
		});
	}

	private selectAll(select: boolean) {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (select) {
				this.selectedPaths.add(file.path);
			} else {
				this.selectedPaths.delete(file.path);
			}
		}
		this.updateSelectedCount();
		this.renderFileList();
	}

	private updateSelectedCount() {
		this.selectedCountEl.textContent = `${this.selectedPaths.size} note${this.selectedPaths.size !== 1 ? "s" : ""} selected`;
	}

	// ── Folder picker ─────────────────────────────────────────────────────

	private async pickFolder(): Promise<string | null> {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
			const { remote } = require("electron") as any;
			const result = await remote.dialog.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select Destination Vault Folder",
			}) as { canceled: boolean; filePaths: string[] };
			const chosen = result.filePaths[0];
			if (!result.canceled && chosen !== undefined) {
				return chosen;
			}
		} catch {
			new Notice("Could not open folder picker. Enter the path manually.");
		}
		return null;
	}

	// ── Copy logic ────────────────────────────────────────────────────────

	private setProgress(text: string) {
		this.progressEl.textContent = text;
	}

	private async runCopy() {
		if (this.selectedPaths.size === 0) {
			new Notice("No notes selected.");
			return;
		}
		if (!this.destinationVault.trim()) {
			new Notice("Please enter or select a destination vault folder.");
			return;
		}

		const destPath = this.destinationVault.trim();
		if (!fs.existsSync(destPath)) {
			new Notice(`Destination folder does not exist: ${destPath}`);
			return;
		}

		this.plugin.settings.lastDestinationVault = destPath;
		this.plugin.settings.includeAttachments = this.includeAttachments;
		this.plugin.settings.preserveFolderStructure = this.preserveFolderStructure;
		await this.plugin.saveSettings();

		this.copyBtn.disabled = true;
		this.copyBtn.textContent = "Copying…";

		const vaultBase = getVaultBasePath(this.app);
		const filesToCopy = new Map<string, string>();

		for (const notePath of this.selectedPaths) {
			filesToCopy.set(notePath, this.resolveDestPath(notePath, destPath));

			if (this.includeAttachments) {
				const noteFile = this.app.vault.getAbstractFileByPath(notePath);
				if (noteFile instanceof TFile) {
					for (const attPath of getAttachmentPaths(this.app, noteFile)) {
						if (!filesToCopy.has(attPath)) {
							filesToCopy.set(attPath, this.resolveDestPath(attPath, destPath));
						}
					}
				}
			}
		}

		const total = filesToCopy.size;
		let done = 0;
		let errors = 0;

		for (const [relSrc, absDest] of filesToCopy) {
			const absSrc = path.join(vaultBase, relSrc);
			try {
				ensureDirSync(path.dirname(absDest));
				fs.copyFileSync(absSrc, absDest);
			} catch (err) {
				console.error(`[Copy Notes] Failed to copy ${absSrc}:`, err);
				errors++;
			}
			done++;
			this.setProgress(`Copying… ${done} / ${total}`);
		}

		this.copyBtn.disabled = false;
		this.copyBtn.textContent = "Copy notes";

		if (errors === 0) {
			this.setProgress(`✓ Done — ${done} file${done !== 1 ? "s" : ""} copied.`);
			new Notice(`Copied ${this.selectedPaths.size} note(s) to ${destPath}`);
		} else {
			this.setProgress(`Done with ${errors} error(s). Check the console for details.`);
			new Notice(`Copy finished with ${errors} error(s).`);
		}
	}

	private resolveDestPath(vaultRelativeSrc: string, destVaultRoot: string): string {
		if (this.preserveFolderStructure) {
			return path.join(destVaultRoot, vaultRelativeSrc);
		}
		return path.join(destVaultRoot, path.basename(vaultRelativeSrc));
	}
}
