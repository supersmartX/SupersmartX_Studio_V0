'use client';

import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The single confirmation pattern for every discard/delete in the Studio.
 *
 * Destructive actions used to mix blocking `window.confirm` with an inline
 * row-level confirm, so the same question looked and behaved differently
 * depending on where it was asked (and a native dialog cannot be styled,
 * announced consistently, or kept in the same focus/language system as the
 * rest of the app). This is one accessible alertdialog for all of them: it
 * traps focus, Escape cancels, and focus returns to the trigger.
 *
 * Cancel takes initial focus — the safe answer — because the dialog is only
 * ever raised for an action that destroys something.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} maxWidth="max-w-md" role="alertdialog">
      <p className="text-sm leading-relaxed text-text-secondary">{message}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" size="md" onClick={onCancel} data-modal-initial-focus>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'destructive' : 'primary'} size="md" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
