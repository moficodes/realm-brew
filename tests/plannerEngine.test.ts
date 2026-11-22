import { describe, expect, it } from 'vitest';
import { placeTile } from '../src/domain/plannerEngine';
import type { Placement } from '../src/domain/types';

describe('Planner engine placement (Seam 2)', () => {
  it('places a new Placement at an empty hex coordinate', () => {
    const placements = placeTile([], {
      q: 1,
      r: -1,
      tilesetId: 'man-hewn-dungeons',
      tileId: '01-02',
      faceNumber: 1,
      rotation: 0,
    });
    expect(placements).toEqual([
      {
        q: 1,
        r: -1,
        tilesetId: 'man-hewn-dungeons',
        tileId: '01-02',
        faceNumber: 1,
        rotation: 0,
      },
    ]);
  });

  it('replaces an existing Placement when placed on an occupied hex coordinate', () => {
    const initial: Placement[] = [
      { q: 0, r: 0, tilesetId: 'man-hewn-dungeons', tileId: '01-02', faceNumber: 1, rotation: 0 },
      { q: 1, r: 0, tilesetId: 'subterranean-rivers', tileId: '03-04', faceNumber: 3, rotation: 2 },
    ];
    const next = placeTile(initial, {
      q: 0,
      r: 0,
      tilesetId: 'underdark-caverns',
      tileId: '05-06',
      faceNumber: 6,
      rotation: 4,
    });
    expect(next).toHaveLength(2);
    expect(next.find((p) => p.q === 0 && p.r === 0)).toEqual({
      q: 0,
      r: 0,
      tilesetId: 'underdark-caverns',
      tileId: '05-06',
      faceNumber: 6,
      rotation: 4,
    });
  });
});
