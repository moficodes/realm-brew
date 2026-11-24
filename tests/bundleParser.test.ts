import { describe, expect, it } from 'vitest';
import {
  canonicalPackKey,
  classifyBundleFolder,
  groupRelativePngPaths,
  normalizeOverlayPackName,
  normalizeTilesetName,
  parseBundleFolders,
  toCleanSlug,
  toTilesetSlug,
} from '../src/domain/bundleParser';

describe('bundleParser - folder classification & normalization', () => {
  it('classifies *Overlays before *Tiles and normalizes pack names and slugs', () => {
    expect(classifyBundleFolder('0 • Realm Brew - Man Hewn Dungeons Tiles')).toBe('tileset');
    expect(classifyBundleFolder('0 • Realm Brew - Man Hewn Dungeons Overlays')).toBe('overlayPack');
    expect(classifyBundleFolder("1 • Realm Brew - Alchemists' Workshop Overlays")).toBe('overlayPack');
    expect(classifyBundleFolder('__MACOSX')).toBeNull();
    expect(classifyBundleFolder('Documentation')).toBeNull();

    expect(normalizeTilesetName('0 • Realm Brew - Man Hewn Dungeons Tiles')).toBe(
      'Man Hewn Dungeons',
    );
    expect(normalizeOverlayPackName('1 • Realm Brew - Goblins’ Hideout Overlays')).toBe(
      'Goblins’ Hideout',
    );
    expect(toTilesetSlug("Wizard's Keep")).toBe('wizard-s-keep');
    expect(toCleanSlug('Goblins’ Hideout')).toBe('goblins-hideout');
    expect(canonicalPackKey('tileset', '0 • Realm Brew - Man Hewn Dungeons Tiles')).toBe(
      'tileset:man-hewn-dungeons',
    );
    expect(canonicalPackKey('overlayPack', '1 • Realm Brew - Goblins’ Hideout Overlays')).toBe(
      'overlayPack:goblins-hideout',
    );
  });
});

describe('bundleParser - groupRelativePngPaths', () => {
  it('groups nested bundle folders, single pack folders, and ignores OS metadata and non-face tile PNGs', () => {
    const grouped = groupRelativePngPaths([
      {
        relativePath:
          'Realm Brew - Complete Bundle v0.2 KS/0 • Realm Brew - Man Hewn Dungeons Tiles/RB Man Hewn Dungeons - Digital Tiles_01.png',
        payload: 'f1',
      },
      {
        relativePath:
          'Realm Brew - Complete Bundle v0.2 KS/0 • Realm Brew - Man Hewn Dungeons Tiles/RB Man Hewn Dungeons - Digital Tiles_02.png',
        payload: 'f2',
      },
      {
        relativePath:
          'Realm Brew - Complete Bundle v0.2 KS/0 • Realm Brew - Man Hewn Dungeons Tiles/preview.png',
        payload: 'non-face',
      },
      {
        relativePath:
          'Realm Brew - Complete Bundle v0.2 KS/0 • Realm Brew - Man Hewn Dungeons Tiles/._RB Man Hewn Dungeons - Digital Tiles_01.png',
        payload: 'apple-double',
      },
      {
        relativePath:
          '__MACOSX/Realm Brew - Complete Bundle v0.2 KS/0 • Realm Brew - Man Hewn Dungeons Tiles/._RB Man Hewn Dungeons - Digital Tiles_02.png',
        payload: 'macosx-junk',
      },
      {
        relativePath:
          'Realm Brew - Complete Bundle v0.2 KS/1 • Realm Brew - Goblins’ Hideout Overlays/Cage 1.png',
        payload: 'ov1',
      },
      {
        relativePath:
          'Realm Brew - Complete Bundle v0.2 KS/1 • Realm Brew - Goblins’ Hideout Overlays/readme.txt',
        payload: 'txt',
      },
      {
        relativePath: '0 • Realm Brew Subterranean Rivers - Digital Tiles/.DS_Store',
        payload: 'ds',
      },
      {
        relativePath:
          '0 • Realm Brew Subterranean Rivers - Digital Tiles/Subterranean Rivers - Digital Tiles_01.png',
        payload: 'sr1',
      },
      {
        relativePath: 'unrelated/diagram.png',
        payload: 'ignored',
      },
    ]);

    expect(grouped).toEqual([
      {
        folderPathKey:
          'Realm Brew - Complete Bundle v0.2 KS/0 • Realm Brew - Man Hewn Dungeons Tiles',
        kind: 'tileset',
        folderName: '0 • Realm Brew - Man Hewn Dungeons Tiles',
        files: [
          { filename: 'RB Man Hewn Dungeons - Digital Tiles_01.png', payload: 'f1' },
          { filename: 'RB Man Hewn Dungeons - Digital Tiles_02.png', payload: 'f2' },
        ],
      },
      {
        folderPathKey:
          'Realm Brew - Complete Bundle v0.2 KS/1 • Realm Brew - Goblins’ Hideout Overlays',
        kind: 'overlayPack',
        folderName: '1 • Realm Brew - Goblins’ Hideout Overlays',
        files: [{ filename: 'Cage 1.png', payload: 'ov1' }],
      },
      {
        folderPathKey: '0 • Realm Brew Subterranean Rivers - Digital Tiles',
        kind: 'tileset',
        folderName: '0 • Realm Brew Subterranean Rivers - Digital Tiles',
        files: [{ filename: 'Subterranean Rivers - Digital Tiles_01.png', payload: 'sr1' }],
      },
    ]);
  });

  it('supports flat single-pack archives using fallbackFolderName', () => {
    const grouped = groupRelativePngPaths(
      [
        { relativePath: 'Door 10.png', payload: 'd10' },
        { relativePath: 'Door 2.png', payload: 'd2' },
        { relativePath: '._Door 2.png', payload: 'junk' },
      ],
      "1 • Realm Brew - Alchemists' Workshop Overlays",
    );

    expect(grouped).toEqual([
      {
        folderPathKey: "1 • Realm Brew - Alchemists' Workshop Overlays",
        kind: 'overlayPack',
        folderName: "1 • Realm Brew - Alchemists' Workshop Overlays",
        files: [
          { filename: 'Door 10.png', payload: 'd10' },
          { filename: 'Door 2.png', payload: 'd2' },
        ],
      },
    ]);
  });
});

describe('bundleParser - parseBundleFolders', () => {
  it('pairs odd/even faces, preserves symmetric tail, pairs overlays, and disambiguates shortCodes', () => {
    const parsed = parseBundleFolders(
      [
        {
          sourceId: 's1',
          folderName: '1 • Realm Brew - Deep Caves Tiles',
          filenames: ['Deep_01.png', 'Deep_02.png', 'Deep_03.png'],
        },
        {
          sourceId: 's2',
          folderName: '2 • Realm Brew - Dark Crypts Tiles',
          filenames: ['Dark_01.png', 'Dark_02.png'],
        },
        {
          sourceId: 's3',
          folderName: '2 • Realm Brew - Dark Crypts Overlays',
          filenames: ['Coffin 10.png', 'Coffin 2.png', '._Coffin 2.png'],
        },
        {
          sourceId: 's4',
          folderName: '3 • Goblin’s Lair Overlays',
          filenames: ['Cage.png'],
        },
      ],
      {
        tileFaceUrl: ({ sourceId, filename }) => `blob:${sourceId}/${filename}`,
        overlayUrl: ({ sourceId, filename }) => `blob:${sourceId}/${filename}`,
      },
    );

    expect(parsed.tilesets.map((t) => ({ id: t.id, shortCode: t.shortCode }))).toEqual([
      { id: 'dark-crypts', shortCode: 'DC' },
      { id: 'deep-caves', shortCode: 'DC2' },
    ]);

    expect(parsed.tilesets[1].tiles).toEqual([
      {
        tileId: '01-02',
        tilesetId: 'deep-caves',
        isSymmetric: false,
        faceA: {
          faceNumber: 1,
          label: '01',
          filename: 'Deep_01.png',
          url: 'blob:s1/Deep_01.png',
        },
        faceB: {
          faceNumber: 2,
          label: '02',
          filename: 'Deep_02.png',
          url: 'blob:s1/Deep_02.png',
        },
      },
      {
        tileId: '03-03',
        tilesetId: 'deep-caves',
        isSymmetric: true,
        faceA: {
          faceNumber: 3,
          label: '03',
          filename: 'Deep_03.png',
          url: 'blob:s1/Deep_03.png',
        },
        faceB: {
          faceNumber: 3,
          label: '03',
          filename: 'Deep_03.png',
          url: 'blob:s1/Deep_03.png',
        },
      },
    ]);

    expect(
      parsed.overlayPacks.map((p) => ({
        id: p.id,
        shortCode: p.shortCode,
        pairedTilesetId: p.pairedTilesetId,
        filenames: p.matchedFilenames,
      })),
    ).toEqual([
      {
        id: 'dark-crypts',
        shortCode: 'DC',
        pairedTilesetId: 'dark-crypts',
        filenames: ['Coffin 2.png', 'Coffin 10.png'],
      },
      {
        id: 'goblins-lair',
        shortCode: 'GL',
        pairedTilesetId: null,
        filenames: ['Cage.png'],
      },
    ]);
  });
});
