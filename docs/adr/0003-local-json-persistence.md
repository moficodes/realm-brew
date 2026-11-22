# Persist Maps and Collection as local JSON files via Vite middleware

Auto-saved Maps and Collection copy counts are persisted as plain JSON files under a gitignored `.data/` directory (`collection.json` and `maps/<id>.json`) through lightweight endpoints on the existing Vite dev/preview middleware (see ADR-0001), alongside manual JSON export/import.

## Considered Options

- **Browser `localStorage` / `IndexedDB`**: Rejected because saved dungeon builds would be tied to one browser profile and port, easily lost when clearing browser data or switching browsers.
- **SQLite or embedded database**: Rejected as overkill for a handful of small user-authored Map documents.

## Consequences

- Maps and Collection settings are plain, human-readable JSON files on disk that survive browser changes and are easy to back up.
- Persistence relies on running through the local Vite server rather than a purely static host, matching the constraint already accepted in ADR-0001.
