const NON_TEXT_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
]);

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'INPUT') {
    const inputType = (target as HTMLInputElement).type?.toLowerCase() || 'text';
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }
  return (
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Return true when Space should activate a focused interactive control instead of panning. */
export function shouldYieldSpacePan(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isEditableTarget(target)) return true;
  return Boolean(
    target.closest(
      'button, a, summary, input:not([type="range"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"]',
    ),
  );
}

/** Round an angle in degrees and normalize it into [0, 360) without -0 for UI display. */
export function formatDisplayDegrees(deg: number): number {
  const rounded = Math.round(deg) % 360;
  const normalized = rounded < 0 ? rounded + 360 : rounded;
  return normalized === 0 ? 0 : normalized;
}

export function slugifyFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'realm-brew-map'
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
