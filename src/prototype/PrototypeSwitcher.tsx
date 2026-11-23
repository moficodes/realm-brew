// THROWAWAY PROTOTYPE SWITCHER BAR (per prototype/UI.md) for Wayfinder #13

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { isEditableTarget } from '../utils/browserHelpers';
import type { VariantKey } from './overlayPrototypeModel';

export const VARIANT_META: Record<
  VariantKey,
  { name: string; summary: string }
> = {
  A: {
    name: 'Smart Direct Canvas',
    summary: 'Unified hit-testing: Overlays first, click-to-cycle stack, live reparenting, stem rotation gizmo.',
  },
  B: {
    name: 'Layer-Scoped Mode',
    summary: 'Explicit Tiles | Overlays edit mode, 7-point hex snap dots, empty-drop revert, inline stack pill, slider + Shift+Wheel spin.',
  },
  C: {
    name: 'Host-Tile Inspector',
    summary: 'Host-first two-tier selection + persistent right Inspector drawer for exact stack, coordinates & rotation.',
  },
};

const VARIANT_ORDER: VariantKey[] = ['A', 'B', 'C'];

interface PrototypeSwitcherProps {
  current: VariantKey;
  onChange: (next: VariantKey) => void;
}

export function PrototypeSwitcher({ current, onChange }: PrototypeSwitcherProps) {
  const stepVariant = (delta: 1 | -1) => {
    const idx = VARIANT_ORDER.indexOf(current);
    const nextIdx = (idx + delta + VARIANT_ORDER.length) % VARIANT_ORDER.length;
    onChange(VARIANT_ORDER[nextIdx]);
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || document.querySelector('dialog[open]')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepVariant(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepVariant(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!import.meta.env.DEV) {
    return null;
  }

  const meta = VARIANT_META[current];

  return (
    <div
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-violet-400/50 bg-violet-950/95 px-2 py-1 text-xs text-violet-100 shadow-2xl backdrop-blur"
      role="navigation"
      aria-label="Prototype variant switcher"
    >
      <button
        type="button"
        onClick={() => stepVariant(-1)}
        title="Previous variant (←)"
        aria-label="Previous variant"
        className="flex h-6 w-6 items-center justify-center rounded-full text-violet-200 transition hover:bg-violet-800/80 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center gap-1.5 px-2">
        <span className="rounded bg-violet-500/30 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-violet-200 uppercase">
          Proto
        </span>
        <span className="whitespace-nowrap font-semibold text-white">
          {current} ({meta.name})
        </span>
      </div>

      <button
        type="button"
        onClick={() => stepVariant(1)}
        title="Next variant (→)"
        aria-label="Next variant"
        className="flex h-6 w-6 items-center justify-center rounded-full text-violet-200 transition hover:bg-violet-800/80 hover:text-white"
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
