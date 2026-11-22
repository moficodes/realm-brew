# Serve Realm Brew assets from a local directory via Vite middleware

Realm Brew tile PNGs (~193 MB across the Kickstarter bundle) are copyrighted assets that may receive future packs or version updates. Instead of committing images to git or relying on browser folder-picker permissions, a lightweight Vite dev/preview middleware reads tilesets dynamically from a local path configured in gitignored `.env.local` (`REALM_BREW_BUNDLE_DIR`).

## Considered Options

- **Commit PNGs into this repository**: Rejected to keep copyrighted Kickstarter files out of git, avoid a ~193 MB repo, and allow future Realm Brew packs to load without code changes.
- **Browser File System Access API (`showDirectoryPicker`)**: Rejected because browsers re-prompt for read permission across restarts and support across Safari/Firefox is inconsistent.

## Consequences

- The app runs locally through Vite (`dev` or `preview`) rather than as a standalone statically hosted page.
- New machines need a local copy of the Realm Brew bundle and `REALM_BREW_BUNDLE_DIR` set in `.env.local`.
