import {
  ArrowRightIcon,
  MapPinIcon,
  PencilSimpleLineIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  readerNotes,
  type BookMention,
  type BookPassage,
} from '../lib/book-annotations';
import { lifespan, type Asset, type AtlasData } from '../lib/gedcom';
import type { Geography } from '../lib/places';
import { identifiedPortrait } from '../lib/visuals';
import { useDismissible, useMediaQuery } from '../lib/useDismissible';
import BrowsingImage from './BrowsingImage';
import '../book-preview.css';
import { sitePath } from '../lib/paths';

function focusable(element: HTMLElement | null) {
  return [
    ...(element?.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
    ) || []),
  ].filter((node) => node.getClientRects().length);
}

/** One shared frame for person/place and exact source-note previews. */
export function BookPreviewFrame({
  trigger,
  label,
  children,
  onClose,
  onPointerEnter,
  onPointerLeave,
  focusOnOpen = false,
  onFollow,
}: {
  trigger: HTMLElement;
  label: string;
  children: ReactNode;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  focusOnOpen?: boolean;
  onFollow?: (event: MouseEvent) => void;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const panelId = useId();
  const small = useMediaQuery('(max-width: 600px)');
  const [position, setPosition] = useState({
    left: 12,
    top: 120,
    maxHeight: 480,
  });
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  const layer = useDismissible({
    enabled: true,
    root: () => panel.current,
    inside: () => [panel.current, trigger],
    trigger: () => trigger,
    onDismiss: onClose,
    consumeOutside: small,
  });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!onFollow || !element) return;
    element.addEventListener('click', onFollow);
    return () => element.removeEventListener('click', onFollow);
  }, [onFollow]);
  useLayoutEffect(() => {
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      const topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const header =
        document.querySelector('.kin-header')?.getBoundingClientRect().bottom ||
        0;
      const minTop = Math.max(topEdge + 12, header + 8);
      const maxHeight = Math.max(
        120,
        Math.min(height - (minTop - topEdge) - 24, small ? height * 0.65 : 520),
      );
      const panelWidth = Math.min(width - 24, 384);
      const measured = Math.min(
        panel.current?.getBoundingClientRect().height || maxHeight,
        maxHeight,
      );
      const below = rect.bottom + 10;
      const above = rect.top - measured - 10;
      const top = small
        ? topEdge + height - measured - 12
        : Math.max(
            minTop,
            below + measured < topEdge + height - 12 ? below : above,
          );
      setPosition({
        left: Math.max(12, Math.min(rect.left, width - panelWidth - 12)),
        top,
        maxHeight,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [trigger, small]);
  useLayoutEffect(() => {
    const previous = ['aria-expanded', 'aria-controls', 'aria-haspopup'].map(
      (name) => [name, trigger.getAttribute(name)],
    );
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', panelId);
    trigger.setAttribute('aria-haspopup', 'dialog');
    const enter = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowDown' ||
        (event.key === 'Tab' && !event.shiftKey)
      ) {
        event.preventDefault();
        focusable(panel.current)[0]?.focus({ preventScroll: true });
      }
    };
    trigger.addEventListener('keydown', enter);
    if (focusOnOpen) panel.current?.focus({ preventScroll: true });
    return () => {
      trigger.removeEventListener('keydown', enter);
      for (const [name, value] of previous) {
        if (value === null) trigger.removeAttribute(name!);
        else trigger.setAttribute(name!, value!);
      }
    };
  }, [trigger, panelId, focusOnOpen]);

  return createPortal(
    <dialog
      ref={panel}
      id={panelId}
      className="book-preview"
      open
      aria-labelledby={titleId}
      tabIndex={-1}
      style={position}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocusCapture={onPointerEnter}
      onBlurCapture={(event) => {
        // Clicking a control can temporarily blur the dialog to BODY before
        // pointerup. Only a known outside focus destination closes here;
        // outside pointer actions are already owned by the dismissal manager.
        const next = event.relatedTarget;
        if (next && !panel.current?.contains(next) && !trigger.contains(next))
          close.current();
      }}
    >
      <div className="book-preview-header">
        <span id={titleId}>{label}</span>
        <button
          aria-label="Close preview"
          onClick={() => layer.dismiss()}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && event.shiftKey) {
              event.preventDefault();
              trigger.focus({ preventScroll: true });
            }
          }}
        >
          <XIcon size={19} />
        </button>
      </div>
      {children}
    </dialog>,
    trigger.closest('dialog[open]') || document.body,
  );
}

export function BookEntityPreview({
  mention,
  passage,
  data,
  geography,
  relationLabel,
  onCorrection,
  imageUrl,
  onPerson,
  onPlace,
  onMap,
}: {
  mention: BookMention;
  passage: BookPassage;
  data: AtlasData;
  geography: Geography | null;
  relationLabel?: (personId: string) => string;
  onCorrection?: (personId: string) => void;
  imageUrl: (asset: Asset) => string;
  onPerson: (id: string) => void;
  onPlace: (id: string) => void;
  onMap: (mention: BookMention) => void;
}) {
  const person =
    mention.kind === 'person'
      ? data.people.find((p) => p.id === mention.target)
      : null;
  const portrait = person ? identifiedPortrait(data, person.id) : null;
  const location = mention.location
    ? geography?.locations.find((p) => p.id === mention.location)
    : null;
  // Reviewed reader notes stay available, folded away. The preview itself is
  // about the person or place, in family-facing language.
  const sourceNotes = readerNotes([
    ...mention.qualifications,
    ...passage.qualifications.map((q) => q.text),
  ]);
  const dates = person ? lifespan(person) : '';
  const relation = person && relationLabel ? relationLabel(person.id) : '';
  return (
    <>
      {person ? (
        <div className="book-preview-person">
          {portrait && (
            <BrowsingImage
              src={imageUrl(portrait)}
              original={sitePath('data/') + portrait.path}
              alt={portrait.title}
            />
          )}
          <div>
            <h3>{person.name}</h3>
            {dates && <p>{dates}</p>}
            {relation && (
              <p className="book-preview-relation">{relation}</p>
            )}
          </div>
        </div>
      ) : (
        <h3>{mention.name}</h3>
      )}
      {mention.kind === 'context' && (
        <p className="book-preview-context">
          A place mentioned in this chapter.
        </p>
      )}
      {sourceNotes.length > 0 && (
        <details className="book-preview-source-notes">
          <summary>Sources</summary>
          {sourceNotes.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </details>
      )}
      <div className="book-preview-actions">
        {person && (
          <button onClick={() => onPerson(person.id)}>
            View family profile <ArrowRightIcon size={17} />
          </button>
        )}
        {mention.kind === 'place' && (
          <button onClick={() => onPlace(mention.target)}>
            Explore this place <ArrowRightIcon size={17} />
          </button>
        )}
        {location && (
          <button onClick={() => onMap(mention)}>
            <MapPinIcon size={17} /> Show on the reading map
          </button>
        )}
        {person && onCorrection && (
          <button onClick={() => onCorrection(person.id)}>
            Suggest a correction <PencilSimpleLineIcon size={17} />
          </button>
        )}
      </div>
    </>
  );
}
