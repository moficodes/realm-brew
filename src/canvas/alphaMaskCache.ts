import type { OverlayHitTestLookup } from '../domain/overlayGeometry';
import { resolveOverlayAsset } from '../domain/plannerEngine';
import type { OverlayPack, OverlayPlacement } from '../domain/types';
import type { ImageLookup } from './mapRenderer';

interface MaskEntry {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

/**
 * Downsampled per-URL alpha mask cache so transparent corners of Overlays do not
 * block clicking underlying Overlays or bare host Tile space.
 */
export class AlphaMaskCache {
  private readonly masks = new Map<string, MaskEntry | 'unavailable'>();

  private getMask(url: string, img: HTMLImageElement | null): MaskEntry | null {
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return null;
    }
    const cached = this.masks.get(url);
    if (cached === 'unavailable') return null;
    if (cached) return cached;

    try {
      const maxDim = 128;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        this.masks.set(url, 'unavailable');
        return null;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8ClampedArray(width * height);
      for (let i = 0; i < width * height; i++) {
        alpha[i] = data[i * 4 + 3];
      }
      const entry = { width, height, alpha };
      this.masks.set(url, entry);
      return entry;
    } catch {
      this.masks.set(url, 'unavailable');
      return null;
    }
  }

  /**
   * Check whether any pixel within `radiusPx` of normalized `[u, v]` has alpha > 20.
   * Falls back to `true` when the mask cannot be extracted so OBB hit-testing still works.
   */
  isOpaqueNear(
    url: string,
    img: HTMLImageElement | null,
    u: number,
    v: number,
    radiusPx = 5,
  ): boolean {
    const mask = this.getMask(url, img);
    if (!mask) return true;

    const cx = Math.min(mask.width - 1, Math.max(0, Math.floor(u * mask.width)));
    const cy = Math.min(mask.height - 1, Math.max(0, Math.floor(v * mask.height)));
    const x0 = Math.max(0, cx - radiusPx);
    const x1 = Math.min(mask.width - 1, cx + radiusPx);
    const y0 = Math.max(0, cy - radiusPx);
    const y1 = Math.min(mask.height - 1, cy + radiusPx);

    for (let y = y0; y <= y1; y++) {
      const rowOffset = y * mask.width;
      for (let x = x0; x <= x1; x++) {
        if (mask.alpha[rowOffset + x] > 20) {
          return true;
        }
      }
    }
    return false;
  }
}

/** Build an OverlayHitTestLookup backed by the live asset registry, ImageLookup, and AlphaMaskCache. */
export function createOverlayHitTestLookup(
  overlayPacksById: ReadonlyMap<string, OverlayPack>,
  imageCache: ImageLookup,
  alphaCache: AlphaMaskCache,
): OverlayHitTestLookup {
  const resolveLoaded = (
    overlay: OverlayPlacement,
  ): { url: string; img: HTMLImageElement } | null => {
    const asset = resolveOverlayAsset(overlay, overlayPacksById);
    if (asset.status !== 'ok' || imageCache.isError(asset.url)) {
      return null;
    }
    const img = imageCache.get(asset.url);
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return null;
    }
    return { url: asset.url, img };
  };

  return {
    getPixelSize(overlay) {
      const loaded = resolveLoaded(overlay);
      if (!loaded) return null;
      return { width: loaded.img.naturalWidth, height: loaded.img.naturalHeight };
    },
    isOpaqueAt(overlay, u, v) {
      const loaded = resolveLoaded(overlay);
      if (!loaded) return true;
      return alphaCache.isOpaqueNear(loaded.url, loaded.img, u, v, 5);
    },
  };
}
