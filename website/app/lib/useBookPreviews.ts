import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type {
  BookAnnotations,
  BookMention,
  BookPassage,
} from './book-annotations';

export type BookPreviewSelection = {
  trigger: HTMLElement;
  focusOnOpen: boolean;
} & (
  | { kind: 'entity'; mention: BookMention; passage: BookPassage }
  | { kind: 'source'; note: HTMLElement }
);

/** Native links retain their destinations; this owns only transient previews. */
export function useBookPreviews(
  content: RefObject<HTMLDivElement | null>,
  annotations: BookAnnotations | undefined,
  resetKey: string,
) {
  const [preview, setPreview] = useState<BookPreviewSelection | null>(null);
  const current = useRef(preview);
  current.current = preview;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressed = useRef<HTMLElement | null>(null);
  const readingTarget = useRef<HTMLElement | null>(null);
  const hoverPaused = useRef(false);
  const mentionById = useMemo(
    () => new Map(annotations?.mentions.map((m) => [m.id, m])),
    [annotations],
  );
  const passageById = useMemo(
    () => new Map(annotations?.passages.map((p) => [p.id, p])),
    [annotations],
  );
  const cancel = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    if (closing.current !== null) clearTimeout(closing.current);
    pending.current = closing.current = null;
  }, []);
  const close = useCallback(() => {
    cancel();
    // A route reset can close an already dismissed preview before its delayed
    // focus restoration runs. Keep that trigger suppressed until a new gesture.
    suppressed.current = current.current?.trigger || suppressed.current;
    current.current = null;
    setPreview(null);
  }, [cancel]);
  const restoreFocus = useCallback(
    (trigger: HTMLElement) => {
      cancel();
      suppressed.current = trigger;
      hoverPaused.current = true;
      current.current = null;
      setPreview(null);
      trigger.focus({ preventScroll: true });
      readingTarget.current?.removeAttribute('data-book-return-target');
      readingTarget.current = trigger;
      trigger.setAttribute('data-book-return-target', 'true');
    },
    [cancel],
  );
  const open = useCallback(
    (trigger: HTMLElement, focusOnOpen = false) => {
      cancel();
      if (!trigger.isConnected || suppressed.current === trigger) return false;
      let selection: BookPreviewSelection | null = null;
      const mention = mentionById.get(trigger.dataset.bookMention || '');
      const passage = mention && passageById.get(mention.passage);
      if (mention && passage)
        selection = { kind: 'entity', trigger, mention, passage, focusOnOpen };
      else if (trigger.getAttribute('role') === 'doc-noteref') {
        const id = trigger.getAttribute('href')?.slice(1);
        const note = id && document.getElementById(id);
        if (note && content.current?.contains(note))
          selection = { kind: 'source', trigger, note, focusOnOpen };
      }
      if (!selection) return false;
      current.current = selection;
      setPreview(selection);
      return true;
    },
    [cancel, content, mentionById, passageById],
  );
  const activate = useCallback(
    (trigger: HTMLElement, focusOnOpen = true) => {
      suppressed.current = null;
      return open(trigger, focusOnOpen);
    },
    [open],
  );
  const leave = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
    if (closing.current !== null) clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      if (!document.activeElement?.closest('.book-preview')) close();
    }, 220);
  }, [close]);
  useEffect(() => {
    close();
    if (!suppressed.current?.isConnected) suppressed.current = null;
    return cancel;
  }, [resetKey, annotations, close, cancel]);
  useEffect(() => {
    // Escape also cancels an imminent hover preview before its dismissal layer
    // has mounted. Existing layers keep ownership of their own Escape action.
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pending.current !== null) cancel();
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [cancel]);
  useEffect(() => {
    const scope = content.current;
    if (!scope) return;
    const target = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            'a[data-book-mention], a[role="doc-noteref"]',
          )
        : null;
    const hover = (event: PointerEvent) => {
      if (
        hoverPaused.current ||
        event.pointerType !== 'mouse' ||
        !matchMedia('(hover: hover)').matches
      )
        return;
      const trigger = target(event);
      if (!trigger || trigger.contains(event.relatedTarget as Node)) return;
      cancel();
      pending.current = setTimeout(() => open(trigger), 180);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || (!event.movementX && !event.movementY)) return;
      if (!hoverPaused.current) return;
      hoverPaused.current = false;
      const trigger = target(event);
      if (trigger && scope.contains(trigger)) hover(event);
    };
    const clearReadingTarget = () => {
      readingTarget.current?.removeAttribute('data-book-return-target');
      readingTarget.current = null;
    };
    const out = (event: PointerEvent) => {
      // Hover closing is for a mouse. A lifted finger also fires pointerout,
      // and Safari on iPhone holds the tap's click until short timers started
      // then have run, so a touch must not start the close timer.
      if (event.pointerType !== 'mouse') return;
      const trigger = target(event);
      if (!trigger || trigger.contains(event.relatedTarget as Node)) return;
      if (suppressed.current === trigger) suppressed.current = null;
      if ((event.relatedTarget as Element | null)?.closest?.('.book-preview'))
        cancel();
      else leave();
    };
    // Touch/mouse focus can arrive before a gesture is recognised as a pan.
    // Only keyboard focus previews automatically; pointer activation waits
    // for the ordinary completed click handled by the reader.
    let pointerFocus = false;
    const pointerDown = () => {
      pointerFocus = true;
      cancel();
      clearReadingTarget();
    };
    const keyDown = () => {
      pointerFocus = false;
      clearReadingTarget();
    };
    const focus = (event: FocusEvent) => {
      const trigger = target(event);
      if (trigger && !pointerFocus) open(trigger);
    };
    const blur = (event: FocusEvent) => {
      const trigger = target(event);
      if (!trigger) return;
      if (suppressed.current === trigger) suppressed.current = null;
      if (!(event.relatedTarget as Element | null)?.closest?.('.book-preview'))
        leave();
    };
    scope.addEventListener('pointerover', hover);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('keydown', keyDown);
    // Position restoration also dispatches scroll. Clear on a new reading
    // gesture instead, so that queued programmatic scroll cannot erase it.
    document.addEventListener('wheel', clearReadingTarget, { passive: true, capture: true });
    scope.addEventListener('pointerout', out);
    scope.addEventListener('focusin', focus);
    scope.addEventListener('focusout', blur);
    return () => {
      cancel();
      scope.removeEventListener('pointerover', hover);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('wheel', clearReadingTarget, true);
      clearReadingTarget();
      scope.removeEventListener('pointerout', out);
      scope.removeEventListener('focusin', focus);
      scope.removeEventListener('focusout', blur);
    };
  }, [content, resetKey, annotations, cancel, open, leave]);
  return { preview, activate, close, restoreFocus, enter: cancel, leave };
}
