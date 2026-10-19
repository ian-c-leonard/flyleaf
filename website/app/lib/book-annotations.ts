import type { PlaceRelation } from './places';
import { bookPreviewCopy } from './book-preview-copy.ts';

/** Produced from reviewed exact passages by website_book_annotations.py. */
export type BookMention = {
  id: string;
  passage: string;
  kind: 'person' | 'place' | 'context';
  target: string;
  name: string;
  label: string;
  qualifications: string[];
  location?: string | null;
  relation?: PlaceRelation;
};

export type BookPassage = {
  id: string;
  chapter: string;
  section: string;
  sha256: string;
  mentions: string[];
  qualifications: {
    text: string;
    kind:
      | 'same-passage'
      | 'other-bound-passage'
      | 'linked-native-note'
      | 'caption'
      | 'register-context';
    note?: string;
  }[];
};

export type BookAnnotations = {
  schema: 1;
  passages: BookPassage[];
  mentions: BookMention[];
};

/** History-only identity: DOM references cannot survive leaving the Book view. */
export type BookFocusTarget = {
  version: string;
  kind: 'mention' | 'id';
  value: string;
};
export function readBookFocus(
  value: unknown,
  version: string,
): BookFocusTarget | null {
  const target = value as Partial<BookFocusTarget> | null;
  return target &&
    /^[a-f0-9]{64}$/.test(version) &&
    target.version === version &&
    (target.kind === 'mention' || target.kind === 'id') &&
    typeof target.value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(target.value)
    ? { version, kind: target.kind, value: target.value }
    : null;
}
export function captureBookFocus(
  trigger: HTMLElement | null,
  version: string,
): BookFocusTarget | null {
  if (!trigger?.isConnected || !trigger.closest('.native-book-reader'))
    return null;
  return readBookFocus(
    {
      version,
      kind: trigger.dataset.bookMention ? 'mention' : 'id',
      value: trigger.dataset.bookMention || trigger.id,
    },
    version,
  );
}

/** Display reviewed wording only for exact mention-qualification matches. */
export function readerQualification(text: string): string {
  return bookPreviewCopy.get(text) ?? text;
}

/** Reviewed reader wording for these notes, without duplicates. Notes that
 * have no reader version stay out of view. */
export function readerNotes(texts: readonly string[]): string[] {
  return [
    ...new Set(
      texts.flatMap((text) => {
        const reader = bookPreviewCopy.get(text);
        return reader ? [reader] : [];
      }),
    ),
  ];
}

/** A preview must never introduce duplicate manuscript or footnote IDs. */
export function previewNoteHTML(note: HTMLElement): string {
  const copy = note.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll('[id]')
    .forEach((element) => element.removeAttribute('id'));
  copy
    .querySelectorAll('[role="doc-backlink"]')
    .forEach((element) => element.remove());
  return copy.innerHTML;
}
