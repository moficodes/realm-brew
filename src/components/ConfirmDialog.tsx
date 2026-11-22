import { AlertTriangle } from 'lucide-react';
import { useCallback, useId, useRef } from 'react';
import { useModalDialog } from './useModalDialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  const handleClose = useCallback(
    (returnValue: string) => {
      if (returnValue === 'confirm') {
        onConfirm();
      } else {
        onCancel();
      }
    },
    [onCancel, onConfirm],
  );

  useModalDialog({
    dialogRef,
    open,
    onClose: handleClose,
    lightDismiss: false,
  });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="w-full max-w-md rounded-xl border border-[#2e2a26] bg-[#161412] p-5 text-stone-100 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 id={titleId} className="text-sm font-semibold text-stone-100">
            {title}
          </h2>
          <p id={descId} className="mt-1.5 text-xs leading-relaxed text-stone-400">
            {description}
          </p>
        </div>
      </div>

      <form method="dialog" className="mt-5 flex justify-end gap-2">
        <button
          type="submit"
          value="cancel"
          autoFocus
          className="rounded-md border border-[#2e2a26] bg-[#1c1917] px-3.5 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-stone-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          value="confirm"
          className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
        >
          {confirmLabel}
        </button>
      </form>
    </dialog>
  );
}
