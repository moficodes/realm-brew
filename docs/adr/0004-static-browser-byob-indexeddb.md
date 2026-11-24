# Support browser-local BYOB and IndexedDB persistence for static GitHub Pages builds

While ADR-0001 and ADR-0003 serve copyrighted Realm Brew PNGs and persist Maps and Collection JSON via local Vite middleware, publishing a static build on GitHub Pages requires running without any backend server and without redistributing Realm Brew artwork.

## Decision

Keep the local Vite middleware workflow intact for local development, and add a browser-local storage mode (`VITE_STORAGE_MODE=browser` or automatic fallback when `/api/tilesets` is unavailable) backed by IndexedDB:

- Extract pure folder/filename discovery (`*Tiles`, `*Overlays`, `_(\d+)\.png` pairing, slug/shortCode generation, and relative path grouping) into `src/domain/bundleParser.ts` shared by both Node middleware (`src/server/bundleDiscovery.ts`) and browser imports (`src/storage/bundleImporter.ts`).
- Let users load their own Realm Brew bundle folder (`webkitdirectory` / drag-and-drop) or `.zip` archives (lazily extracted in-browser via `@zip.js/zip.js`) into IndexedDB (`src/storage/browserStorage.ts`), serving images as same-origin `blob:` URLs so Canvas alpha hit-testing and PNG exports stay untainted.
- Persist Collection copy counts and Map documents in IndexedDB alongside manual JSON export/import.

## Consequences

- No copyrighted Realm Brew PNGs are committed to git or hosted on GitHub Pages.
- Users import their own bundle once per browser and keep offline access across reloads without re-granting `showDirectoryPicker` permissions.
- Local development with `REALM_BREW_BUNDLE_DIR` and `.data/` JSON files continues to work unchanged.
