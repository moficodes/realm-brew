# Realm Brew Map Planner

A browser-based dungeon and encounter planner for laying out physical Realm Brew hexagonal Tiles and transparent Overlays, tracking owned physical copies in your Collection, running spoiler-safe Fog of War, and generating tabletop Pull Lists and PNG exports.

**Live App:** https://virtualrealm.tabletoptown.app/

> **Artwork not included:** This repository contains zero Realm Brew tile or overlay images. You must provide your own legally acquired Realm Brew digital bundle (`*Tiles` and `*Overlays` folders or `.zip` archives).

## Using the Hosted Web App

1. Open [virtualrealm.tabletoptown.app](https://virtualrealm.tabletoptown.app/) in your browser and click **Bundle** (or **Load Bundle…** in the Palette).
2. Drop or choose your unzipped Realm Brew bundle folder, individual `*Tiles` / `*Overlays` pack folders, or `.zip` archive(s).
3. Your PNGs, Collection copy counts, and saved Maps are stored locally in your browser's IndexedDB—nothing is uploaded to any server.
4. Use **Export JSON** / **Import JSON** in the Map switcher to back up or move Maps between browsers.

## Local Development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and point `REALM_BREW_BUNDLE_DIR` to your local Realm Brew bundle directory:

   ```sh
   cp .env.example .env.local
   ```

3. Start the dev server (serves assets directly from disk and persists Maps/Collection under `.data/`):

   ```sh
   npm run dev
   ```

4. Run tests and checks:

   ```sh
   npm test
   npm run typecheck
   npm run build
   ```
