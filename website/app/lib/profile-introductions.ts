import type { BookMention, BookPassage } from './book-annotations';
import type { BookCitation } from './native-book';
import { safeRelativePath } from './local-assets.ts';

export type ProfileNote = {
  offset: number;
  anchor: string;
  text: string;
  citations: BookCitation[];
};
export type ProfileRegisterLink = {
  start: number;
  end: number;
  anchor: string;
  person: string;
  number: number;
  label: string;
};
export type ProfileBlock = {
  passage: string;
  section: string;
  chapter: string;
  sha256: string;
  contextSha256: string;
  text: string;
  mentions: BookMention[];
  qualifications: Omit<BookPassage['qualifications'][number], 'note'>[];
  notes: ProfileNote[];
  registerLinks?: ProfileRegisterLink[];
  sourceGroups?: number[][];
};
export type ProfileIntroduction = { person: string; blocks: ProfileBlock[] };

const digest = /^[a-f0-9]{64}$/;
const identity = /^[a-z0-9][a-z0-9-]*$/;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function citation(value: unknown): value is BookCitation {
  if (!object(value)) return false;
  return (
    typeof value.person === 'string' &&
    identity.test(value.person) &&
    typeof value.key === 'string' &&
    !!value.key &&
    (value.sourcePointer === null ||
      (typeof value.sourcePointer === 'string' &&
        /^@[^@\s]+@$/.test(value.sourcePointer))) &&
    strings(value.legacyNotes) &&
    typeof value.label === 'string' &&
    typeof value.url === 'string' &&
    strings(value.locators) &&
    strings(value.files) &&
    value.files.every((path) => !!safeRelativePath(path))
  );
}

/** Generated introductions travel with the same checked Book/PDF descriptor. */
export function validProfileIntroductions(
  value: unknown,
  anchors: string[],
): value is ProfileIntroduction[] {
  if (!Array.isArray(value)) return false;
  const people = new Set<string>();
  for (const entry of value) {
    if (
      !object(entry) ||
      typeof entry.person !== 'string' ||
      !identity.test(entry.person) ||
      people.has(entry.person) ||
      !Array.isArray(entry.blocks) ||
      entry.blocks.length < 1 ||
      entry.blocks.length > 12
    )
      return false;
    people.add(entry.person);
    const passages = new Set<string>();
    for (const block of entry.blocks) {
      if (
        !object(block) ||
        typeof block.passage !== 'string' ||
        !/^[A-Za-z0-9-]+$/.test(block.passage) ||
        passages.has(block.passage) ||
        typeof block.section !== 'string' ||
        !anchors.includes(block.section) ||
        typeof block.chapter !== 'string' ||
        !block.chapter.startsWith('ch-') ||
        !anchors.includes(block.chapter) ||
        typeof block.sha256 !== 'string' ||
        !digest.test(block.sha256) ||
        typeof block.contextSha256 !== 'string' ||
        !digest.test(block.contextSha256) ||
        typeof block.text !== 'string' ||
        !block.text.trim() ||
        !Array.isArray(block.mentions) ||
        !Array.isArray(block.qualifications) ||
        !Array.isArray(block.notes)
      )
        return false;
      passages.add(block.passage);
      const mentions = new Set<string>();
      for (const mention of block.mentions) {
        if (
          !object(mention) ||
          typeof mention.id !== 'string' ||
          mentions.has(mention.id) ||
          mention.passage !== block.passage ||
          !['person', 'place', 'context'].includes(String(mention.kind)) ||
          typeof mention.target !== 'string' ||
          typeof mention.name !== 'string' ||
          typeof mention.label !== 'string' ||
          !strings(mention.qualifications)
        )
          return false;
        mentions.add(mention.id);
      }
      if (
        block.qualifications.some(
          (q) =>
            !object(q) ||
            typeof q.text !== 'string' ||
            ![
              'same-passage',
              'other-bound-passage',
              'linked-native-note',
              'caption',
              'register-context',
            ].includes(String(q.kind)),
        )
      )
        return false;
      let position = 0;
      for (const note of block.notes) {
        if (
          !object(note) ||
          typeof note.offset !== 'number' ||
          !Number.isSafeInteger(note.offset) ||
          note.offset < position ||
          note.offset <= 0 ||
          note.offset > Array.from(block.text).length ||
          typeof note.anchor !== 'string' ||
          !/^(?:loc-|book-note-)\d+$/.test(note.anchor) ||
          typeof note.text !== 'string' ||
          !note.text.trim() ||
          !Array.isArray(note.citations) ||
          !note.citations.length ||
          !note.citations.every(citation)
        )
          return false;
        position = note.offset;
      }
      const text = Array.from(block.text);
      if (block.registerLinks !== undefined) {
        if (!Array.isArray(block.registerLinks)) return false;
        let end = 0;
        for (const link of block.registerLinks) {
          if (
            !object(link) ||
            Object.keys(link).sort().join(',') !==
              'anchor,end,label,number,person,start' ||
            !Number.isSafeInteger(link.start) ||
            !Number.isSafeInteger(link.end) ||
            typeof link.start !== 'number' ||
            typeof link.end !== 'number' ||
            link.start < end ||
            link.end <= link.start ||
            link.end > text.length ||
            typeof link.anchor !== 'string' ||
            !link.anchor.startsWith('reg-') ||
            !anchors.includes(link.anchor) ||
            typeof link.person !== 'string' ||
            !identity.test(link.person) ||
            !block.mentions.some(
              (m) =>
                object(m) && m.kind === 'person' && m.target === link.person,
            ) ||
            !Number.isSafeInteger(link.number) ||
            typeof link.number !== 'number' ||
            link.number < 1 ||
            typeof link.label !== 'string' ||
            !link.label.trim() ||
            !text.slice(link.start, link.end).join('').includes(link.label)
          )
            return false;
          const reference = /\(no\. ([1-9][0-9]*)\)/.exec(text.slice(link.start, link.end).join(''));
          if (reference && Number(reference[1]) !== link.number) return false;
          const first = link.start,
            last = link.end;
          if (
            block.notes.some(
              (note) =>
                object(note) &&
                typeof note.offset === 'number' &&
                note.offset > first &&
                note.offset < last,
            )
          )
            return false;
          end = link.end;
        }
      }
      if (block.sourceGroups !== undefined) {
        if (!Array.isArray(block.sourceGroups)) return false;
        let last = -1;
        for (const group of block.sourceGroups) {
          if (!Array.isArray(group) || group.length < 2) return false;
          for (let i = 0; i < group.length; i++) {
            const index: unknown = group[i];
            if (
              typeof index !== 'number' ||
              !Number.isSafeInteger(index) ||
              index < 0 ||
              index >= block.notes.length ||
              (i === 0 ? index <= last : index !== group[i - 1] + 1)
            )
              return false;
            if (i > 0) {
              const previous = block.notes[group[i - 1]] as ProfileNote;
              const next = block.notes[index] as ProfileNote;
              if (
                !/^\s*,\s*$/.test(
                  text.slice(previous.offset, next.offset).join(''),
                )
              )
                return false;
            }
          }
          last = group[group.length - 1];
          const start = (block.notes[group[0]] as ProfileNote).offset;
          const end = (block.notes[last] as ProfileNote).offset;
          if (
            block.registerLinks?.some(
              (link: ProfileRegisterLink) =>
                link.start < end && link.end > start,
            )
          )
            return false;
        }
      }
    }
    const first = entry.blocks[0] as ProfileBlock;
    if (
      !first.mentions.some(
        (m) => m.kind === 'person' && m.target === entry.person,
      )
    )
      return false;
  }
  return true;
}

export type IntroductionRun =
  | { text: string }
  | { note: ProfileNote; index: number };

/** Offsets are Unicode code points, just like the native annotation contract. */
export function introductionRuns(block: ProfileBlock): IntroductionRun[] {
  const text = Array.from(block.text);
  const runs: IntroductionRun[] = [];
  let previous = 0;
  block.notes.forEach((note, index) => {
    if (note.offset > previous)
      runs.push({ text: text.slice(previous, note.offset).join('') });
    runs.push({ note, index });
    previous = note.offset;
  });
  if (previous < text.length)
    runs.push({ text: text.slice(previous).join('') });
  return runs;
}

export type IntroductionDisplayRun =
  | IntroductionRun
  | { register: ProfileRegisterLink; label: string }
  | { group: IntroductionRun[] };

/** Additional controls derive from actual Book nodes; canonical runs stay unchanged. */
export function introductionDisplayRuns(
  block: ProfileBlock,
): IntroductionDisplayRun[] {
  const text = Array.from(block.text);
  const grouped = new Set((block.sourceGroups ?? []).flat());
  const events: { start: number; end: number; run: IntroductionDisplayRun }[] =
    (block.registerLinks ?? []).map((link) => ({
      start: link.start,
      end: link.end,
      run: { register: link, label: text.slice(link.start, link.end).join('') },
    }));
  for (const members of block.sourceGroups ?? []) {
    const runs: IntroductionRun[] = [];
    members.forEach((index, i) => {
      const note = block.notes[index];
      if (i > 0)
        runs.push({
          text: text
            .slice(block.notes[members[i - 1]].offset, note.offset)
            .join(''),
        });
      runs.push({ note, index });
    });
    events.push({
      start: block.notes[members[0]].offset,
      end: block.notes[members[members.length - 1]].offset,
      run: { group: runs },
    });
  }
  block.notes.forEach((note, index) => {
    if (!grouped.has(index))
      events.push({
        start: note.offset,
        end: note.offset,
        run: { note, index },
      });
  });
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  const runs: IntroductionDisplayRun[] = [];
  let previous = 0;
  for (const event of events) {
    if (event.start > previous)
      runs.push({ text: text.slice(previous, event.start).join('') });
    runs.push(event.run);
    previous = event.end;
  }
  if (previous < text.length)
    runs.push({ text: text.slice(previous).join('') });
  return runs;
}
