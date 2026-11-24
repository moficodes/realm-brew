import type { CSSProperties } from 'react';

const CHECKERBOARD_GRADIENT =
  'linear-gradient(45deg, #272320 25%, transparent 25%), linear-gradient(-45deg, #272320 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #272320 75%), linear-gradient(-45deg, transparent 75%, #272320 75%)';

function makeCheckerboardStyle(tileSizePx: number): CSSProperties {
  const half = tileSizePx / 2;
  return {
    backgroundImage: CHECKERBOARD_GRADIENT,
    backgroundSize: `${tileSizePx}px ${tileSizePx}px`,
    backgroundPosition: `0 0, 0 ${half}px, ${half}px -${half}px, -${half}px 0`,
    backgroundColor: '#1e1b18',
  };
}

/** 12px checkerboard backdrop for Palette Overlay thumbnails. */
export const CHECKERBOARD_STYLE: CSSProperties = makeCheckerboardStyle(12);

/** 8px checkerboard backdrop for compact Inspector and Pull List Overlay thumbnails. */
export const CHECKERBOARD_MINI_STYLE: CSSProperties = makeCheckerboardStyle(8);
