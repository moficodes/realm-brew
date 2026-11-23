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
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT') {
    const inputType = (target as HTMLInputElement).type?.toLowerCase() ?? 'text';
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }
  return (
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/** Return true when Space should activate a focused interactive control instead of panning. */
export function shouldYieldSpacePan(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isEditableTarget(target)) return true;
  return Boolean(
    target.closest('button, a[href], input, select, textarea, [role="button"], [role="tab"]'),
  );
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
