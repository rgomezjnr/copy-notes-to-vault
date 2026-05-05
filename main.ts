import {
  App,
  FileSystemAdapter,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";

interface CopyNotesSettings {
  lastDestinationVault: string;
  includeAttachments: boolean;
  preserveFolderStructure: boolean;
}

const DEFAULT_SETTINGS: CopyNotesSettings = {
  lastDestinationVault: "",
  includeAttachments: true,
  preserveFolderStructure: true,
};

export default class CopyNotesPlugin extends Plugin {
  settings: CopyNotesSettings;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVaultBasePath(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }
  throw new Error("This plugin requires a local (desktop) vault.");
}

function ensureDirSync(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Collect all TFiles reachable from a TFolder (recursive). */
function collectFiles(folder: TFolder): TFile[] {
  const result: TFile[] = [];
  for (const child of folder.children) {
    if (child instanceof TFile) {
      result.push(child);
    } else if (child instanceof TFolder) {
      result.push(...collectFiles(child));
    }
  }
  return result;
}

/**
 * Return the set of vault-relative paths for every attachment embedded or
 * linked within `file`, using Obsidian's metadata cache for resolution.
 */
function getAttachmentPaths(app: App, file: TFile): Set<string> {
  const found = new Set<string>();
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return found;

  const candidates = [
    ...(cache.embeds ?? []),
    ...(cache.links ?? []),
  ];

  for (const ref of candidates) {
    const resolved = app.metadataCache.getFirstLinkpathDest(
      ref.link.split("#")[0], // strip heading/block anchors
      file.path
    );
    if (resolved && resolved.extension !== "md") {
      found.add(resolved.path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

class CopyNotesModal extends Modal {
  plugin: CopyNotesPlugin;
  private selectedPaths = new Set<string>();
  private destinationVault: string;
  private includeAttachments: boolean;
  private preserveFolderStructure: boolean;
  private searchQuery = "";

  // DOM refs updated during operations
  private progressEl: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private fileListEl: HTMLElement;
  private selectedCountEl: HTMLElement;

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

    // ── Top controls row ──────────────────────────────────────────────────
    const controls = contentEl.createDiv("copy-notes-controls");

    // Search
    const searchInput = controls.createEl("input", {
      type: "text",
      placeholder: "Search notes…",
      cls: "copy-notes-search",
    });
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderFileList();
    });

    // Selection buttons
    const selectionBtns = controls.createDiv("copy-notes-selection-btns");
    const selectAllBtn = selectionBtns.createEl("button", { text: "Select all" });
    selectAllBtn.addEventListener("click", () => this.selectAll(true));
    const deselectAllBtn = selectionBtns.createEl("button", { text: "Deselect all" });
    deselectAllBtn.addEventListener("click", () => this.selectAll(false));

    // Selected count
    this.selectedCountEl = controls.createDiv("copy-notes-count");
    this.updateSelectedCount();

    // ── File list ─────────────────────────────────────────────────────────
    this.fileListEl = contentEl.createDiv("copy-notes-file-list");
    this.renderFileList();

    // ── Options ───────────────────────────────────────────────────────────
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

    // ── Destination vault ─────────────────────────────────────────────────
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

    // ── Progress + copy button ────────────────────────────────────────────
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

  // ── File-list rendering ────────────────────────────────────────────────

  private renderFileList() {
    this.fileListEl.empty();
    const root = this.app.vault.getRoot();
    this.renderFolder(root, this.fileListEl, 0);
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
    const allMd = this.app.vault.getMarkdownFiles();
    for (const file of allMd) {
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

  // ── Folder picker (Electron dialog) ───────────────────────────────────

  private async pickFolder(): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { remote } = require("electron");
      const result = await remote.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Destination Vault Folder",
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
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

    // Save settings
    this.plugin.settings.lastDestinationVault = destPath;
    this.plugin.settings.includeAttachments = this.includeAttachments;
    this.plugin.settings.preserveFolderStructure = this.preserveFolderStructure;
    await this.plugin.saveSettings();

    this.copyBtn.disabled = true;
    this.copyBtn.textContent = "Copying…";

    const vaultBase = getVaultBasePath(this.app);
    const filesToCopy = new Map<string, string>(); // vaultRelativeSrc → destAbsolute

    // Resolve notes
    for (const notePath of this.selectedPaths) {
      const destFile = this.resolveDestPath(notePath, destPath);
      filesToCopy.set(notePath, destFile);

      // Resolve attachments
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
    // Flatten: put everything directly in vault root
    return path.join(destVaultRoot, path.basename(vaultRelativeSrc));
  }
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class CopyNotesSettingTab extends PluginSettingTab {
  plugin: CopyNotesPlugin;

  constructor(app: App, plugin: CopyNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Copy Notes to Vault" });

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
