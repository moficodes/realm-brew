import type { Placement } from './types';

export function placeTile(placements: readonly Placement[], nextPlacement: Placement): Placement[] {
  const remaining = placements.filter(
    (p) => !(p.q === nextPlacement.q && p.r === nextPlacement.r),
  );
  return [...remaining, { ...nextPlacement }];
}
