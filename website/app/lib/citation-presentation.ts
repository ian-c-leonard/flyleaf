import type { BookCitation } from './native-book';
import type { ArchiveDocument } from './archive';
import { safeRelativePath } from './local-assets.ts';

/** Authored display only, checked against exact Book source context at build. */
export type CitationPresentation = {
  person: string;
  key: string;
  contextSha256: string;
  title: string;
  context: string;
  qualifications: string[];
  preferredFile?: string;
  /** One-based physical PDF page, explicitly reviewed against preferredFile. */
  preferredPdfPage?: number;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const email = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const displayText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= limit && !email.test(value);

export function validCitationPresentation(
  value: unknown,
  citations?: BookCitation[],
): value is CitationPresentation[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!object(entry) ||
      Object.keys(entry).some((key) => !['person', 'key', 'contextSha256', 'title', 'context', 'qualifications', 'preferredFile', 'preferredPdfPage'].includes(key)) ||
      typeof entry.person !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.person) ||
      typeof entry.key !== 'string' || !entry.key ||
      typeof entry.contextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contextSha256) ||
      !displayText(entry.title, 640) || !displayText(entry.context, 1600) ||
      !Array.isArray(entry.qualifications) || entry.qualifications.length > 8 ||
      !entry.qualifications.every((q) => displayText(q, 1200)) ||
      (entry.preferredFile !== undefined &&
        (typeof entry.preferredFile !== 'string' || safeRelativePath(entry.preferredFile) !== entry.preferredFile)) ||
      (entry.preferredPdfPage !== undefined &&
        (typeof entry.preferredPdfPage !== 'number' || !Number.isSafeInteger(entry.preferredPdfPage) ||
          entry.preferredPdfPage < 1 || typeof entry.preferredFile !== 'string' ||
          !entry.preferredFile.toLowerCase().endsWith('.pdf')))) return false;
    const identity = entry.person + '\0' + entry.key;
    if (seen.has(identity)) return false;
    seen.add(identity);
    if (citations) {
      const matches = citations.filter((c) => c.person === entry.person && c.key === entry.key);
      if (matches.length !== 1 ||
        (entry.preferredFile && !matches[0].files.includes(entry.preferredFile))) return false;
    }
  }
  return true;
}

/** Page intent belongs to an exact reviewed native use, never a filename alone. */
export function preferredCitationPdfPage(
  document: ArchiveDocument,
  filePath: string,
  presentations: CitationPresentation[] = [],
): number | undefined {
  const use = document.selectedUse;
  if (document.context !== 'source' || document.unavailableUse || !use?.key ||
    !document.sourceIds.includes(use.sourceId) ||
    !document.citationFilePaths?.includes(filePath) ||
    !document.archives.some((file) => file.path === filePath)) return undefined;
  const matches = presentations.filter((entry) =>
    entry.key === use.key && use.owner.people.includes(entry.person),
  );
  if (matches.length !== 1) return undefined;
  const entry = matches[0];
  return entry.preferredFile === filePath &&
    filePath.toLowerCase().endsWith('.pdf') &&
    Number.isSafeInteger(entry.preferredPdfPage) && entry.preferredPdfPage! > 0
    ? entry.preferredPdfPage : undefined;
}

/** A multi-source note changes presentation only when every exact use is reviewed. */
export function presentationsForNote(
  citations: Pick<BookCitation, 'person' | 'key'>[],
  presentations: CitationPresentation[] = [],
): CitationPresentation[] {
  const identities = [...new Set(citations.map((c) => c.person + '\0' + c.key))];
  const selected = identities.map((identity) => presentations.find((p) =>
    p.person + '\0' + p.key === identity,
  ));
  return identities.length && selected.every((p) => p !== undefined)
    ? selected as CitationPresentation[] : [];
}
