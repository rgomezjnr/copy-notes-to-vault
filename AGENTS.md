# Copy Notes to Vault — Obsidian Plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and `styles.css`.
- Desktop-only (`isDesktopOnly: true`): uses Node.js `fs` for filesystem access and Electron's dialog API for the folder picker.

## Environment & tooling

- Node.js: current LTS (Node 18+ recommended).
- **Package manager: npm** (`package.json` defines scripts and dependencies).
- **Bundler: esbuild** (`esbuild.config.mjs` — bundles `src/main.ts` → `main.js`).
- **Linter: ESLint** with `eslint-plugin-obsidianmd` and `typescript-eslint` (flat config in `eslint.config.mts`).
- Types: `obsidian` type definitions (in `dependencies`).

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## File & folder conventions

- Source lives in `src/`. Keep `src/main.ts` small — only plugin lifecycle and registration.
- **Do not commit build artifacts**: never commit `node_modules/` or `main.js`.

```
src/
  main.ts       # Plugin entry point, lifecycle (onload/onunload), command & ribbon registration
  settings.ts   # CopyNotesSettings interface, DEFAULT_SETTINGS, CopyNotesSettingTab
  modal.ts      # CopyNotesModal — the main copy GUI
  utils.ts      # Pure helpers: vault path resolution, fs utilities, attachment parsing
styles.css      # Modal and UI styles
```

## Source module responsibilities

| File | Responsibility |
|---|---|
| `src/main.ts` | Plugin class, settings load/save, addCommand, addRibbonIcon, addSettingTab |
| `src/settings.ts` | `CopyNotesSettings` interface, `DEFAULT_SETTINGS`, `CopyNotesSettingTab` class |
| `src/modal.ts` | `CopyNotesModal` — file-tree UI, destination picker, copy orchestration |
| `src/utils.ts` | `getVaultBasePath`, `ensureDirSync`, `getAttachmentPaths` |

## Manifest rules (`manifest.json`)

- `id`: `copy-notes-to-vault` — never change after release.
- `isDesktopOnly`: must remain `true` (uses Node.js `fs` and Electron APIs).
- Keep `minAppVersion` accurate when adopting newer Obsidian APIs.

## Testing

Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` to:

```
<Vault>/.obsidian/plugins/copy-notes-to-vault/
```

Reload Obsidian and enable the plugin in **Settings → Community plugins**.

A test vault is provided at `test/vault1/` for convenience.

## Versioning & releases

- Bump `version` in `package.json`. The `npm version` script updates `manifest.json` and `versions.json` automatically via `version-bump.mjs`.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` to the release as individual assets.

## Key APIs used

- `app.vault.getMarkdownFiles()` — enumerate notes.
- `app.metadataCache.getFileCache(file)` — resolve embedded/linked files without regex.
- `app.metadataCache.getFirstLinkpathDest(link, sourcePath)` — resolve a link to a `TFile`.
- `FileSystemAdapter.getBasePath()` — get the absolute vault root path.
- Node.js `fs.copyFileSync` / `fs.mkdirSync` — copy files outside the vault.
- Electron `remote.dialog.showOpenDialog` — native folder picker.

## Security & privacy

- The plugin only reads files from the current vault and writes to a user-specified destination folder.
- No network requests are made.
- No telemetry or analytics.

## Coding conventions

- TypeScript with strict mode (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, etc.).
- `async/await` over promise chains; handle errors with try/catch.
- Keep `src/main.ts` under ~50 lines — delegate all logic to other modules.
- Use `import type` for plugin class references in settings/modal to avoid circular imports.

## Agent do/don't

**Do**
- Keep the file-tree rendering in `src/modal.ts`.
- Use Obsidian's metadata cache for link/embed resolution (never raw regex on note content).
- Pass the plugin instance by reference; do not duplicate settings state.
- Use `this.registerEvent` / `this.registerDomEvent` for any event listeners added in `onload`.

**Don't**
- Add network calls — this plugin is fully offline.
- Move `isDesktopOnly` to `false` without removing all Node.js/Electron API usage.
- Access files outside the vault except to write to the explicitly user-chosen destination.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
