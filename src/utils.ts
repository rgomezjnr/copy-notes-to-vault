import { App, FileSystemAdapter, TFile, TFolder } from "obsidian";
import * as fs from "fs";

export function getVaultBasePath(app: App): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getBasePath();
	}
	throw new Error("This plugin requires a local (desktop) vault.");
}

export function ensureDirSync(dirPath: string) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

export function collectFiles(folder: TFolder): TFile[] {
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

export function getAttachmentPaths(app: App, file: TFile): Set<string> {
	const found = new Set<string>();
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return found;

	const candidates = [
		...(cache.embeds ?? []),
		...(cache.links ?? []),
	];

	for (const ref of candidates) {
		const resolved = app.metadataCache.getFirstLinkpathDest(
			ref.link.split("#")[0] ?? ref.link,
			file.path
		);
		if (resolved && resolved.extension !== "md") {
			found.add(resolved.path);
		}
	}
	return found;
}
