import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEventHandler, ReactNode } from 'react';
import { DismissParent, useDismissible } from '../lib/useDismissible';

/** Native focus containment, with shared topmost Escape/outside dismissal. */
export default function Modal({
  children,
  label,
  onClose,
  className = '',
  insideSelector,
  returnFocus,
  fallbackFocus,
  onKeyDown,
  initialFocusSelector,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
  // Full-viewport viewers declare their actual paper/image/controls here.
  // Ordinary paper dialogs include their own padding as inside content.
  insideSelector?: string;
  returnFocus?: () => HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
  /** Opt-in reading dialogs begin at their heading, without native autofocus scroll. */
  initialFocusSelector?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const initialReturnFocus = useRef(returnFocus);
  const initialFocus = useRef(initialFocusSelector);
  const layer = useDismissible({
    enabled: true,
    modal: true,
    root: () => dialog.current,
    inside: () =>
      insideSelector
        ? [
            ...(dialog.current?.querySelectorAll<HTMLElement>(insideSelector) ||
              []),
          ]
        : [dialog.current],
    trigger: () => opener.current,
    fallback: () => fallbackFocus?.() || null,
    onDismiss: () => {
      // Release native inertness before a caller returns focus to its marker.
      dialog.current?.close();
      onClose();
    },
  });
  useLayoutEffect(() => {
    const element = dialog.current!;
    opener.current =
      initialReturnFocus.current?.() ||
      (element.ownerDocument.activeElement instanceof HTMLElement
        ? element.ownerDocument.activeElement
        : null);
    element.showModal();
    const initial = initialFocus.current
      ? element.querySelector<HTMLElement>(initialFocus.current)
      : null;
    if (initial) {
      initial.focus({ preventScroll: true });
      element.scrollTop = 0;
    }
    return () => element.close();
  }, []);
  return (
    <DismissParent value={layer.id}>
      <dialog
        ref={dialog}
        className={`atlas-dialog ${className}`}
        aria-label={label}
        onKeyDown={onKeyDown}
        onCancel={(event) => {
          event.stopPropagation();
          layer.cancel(event.nativeEvent);
        }}
        onClickCapture={(event) => {
          if (
            !(event.target instanceof Element) ||
            event.target.closest('dialog') !== dialog.current ||
            !event.target.closest('[data-dismiss-modal]')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          layer.dismiss();
        }}
      >
        {children}
      </dialog>
    </DismissParent>
  );
}
