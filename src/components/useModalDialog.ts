import { useEffect, type RefObject } from 'react';

interface UseModalDialogOptions {
  dialogRef: RefObject<HTMLDialogElement | null>;
  open: boolean;
  onClose: () => void;
  lightDismiss?: boolean;
}

function isOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

/**
 * Coordinates React `open` state with native `<dialog>.showModal()` and provides
 * Safari light-dismiss fallback when `closedby="any"` is unsupported.
 */
export function useModalDialog({
  dialogRef,
  open,
  onClose,
  lightDismiss = false,
}: UseModalDialogOptions): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [dialogRef, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    if (!lightDismiss || 'closedBy' in HTMLDialogElement.prototype) {
      return () => {
        dialog.removeEventListener('close', handleClose);
      };
    }

    let pressedOutside = false;
    const handlePointerDown = (event: PointerEvent) => {
      pressedOutside = isOutsideDialog(event, dialog);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (pressedOutside && isOutsideDialog(event, dialog)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dialogRef, lightDismiss, onClose]);
}
