import { useRef, useState } from 'react';
import {
  ArrowRightIcon,
  BookOpenTextIcon,
} from '@phosphor-icons/react';
import type { AtlasData } from '../lib/gedcom';
import type { ArchiveDocument } from '../lib/archive';
import { citationDocuments, type ReadingSection } from '../lib/native-book';
import { readerQualification } from '../lib/book-annotations';
import {
  introductionDisplayRuns,
  type ProfileBlock,
  type ProfileIntroduction as Introduction,
  type ProfileNote,
} from '../lib/profile-introductions';
import Modal from './Modal';
import SourceCitationPresentation from './SourceCitationPresentation';
import {
  presentationsForNote,
  type CitationPresentation,
} from '../lib/citation-presentation';
import { albumsInEdition } from '../lib/albums';
import '../profile-introduction.css';

/** Whole reviewed Book paragraphs; no independent profile biography text. */
export default function ProfileIntroduction({
  introduction,
  data,
  sections,
  onReadBook,
  onDocument,
  onAlbum,
  citationPresentation = [],
}: {
  introduction: Introduction;
  data: AtlasData;
  sections: ReadingSection[];
  onReadBook: (section: string, note?: string) => void;
  onDocument: (document: ArchiveDocument, note: ProfileNote) => void;
  onAlbum?: (id: string) => void;
  citationPresentation?: CitationPresentation[];
}) {
  const [active, setActive] = useState<{
    block: ProfileBlock;
    note: ProfileNote;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const presentations = active
    ? presentationsForNote(active.note.citations, citationPresentation)
    : [];
  const albums = active
    ? albumsInEdition(data).filter((album) =>
        active.note.citations.some(
          (citation) =>
            citation.sourcePointer === album.source &&
            citation.person === album.person,
        ),
      )
    : [];
  const documents = active
    ? active.note.citations
        .flatMap((citation) =>
          citationDocuments(
            data,
            citation,
            citationPresentation.find(
              (entry) =>
                entry.person === citation.person && entry.key === citation.key,
            )?.preferredFile,
          ),
        )
        .filter(
          (document, i, all) =>
            all.findIndex(
              (d) =>
                d.id === document.id &&
                d.selectedUse?.id === document.selectedUse?.id,
            ) === i,
        )
    : [];
  const context = active
    ? [
        ...new Set([
          ...active.block.qualifications
            .filter((q) => q.kind !== 'linked-native-note')
            .map((q) => q.text),
          ...active.block.mentions.flatMap((m) => m.qualifications),
        ]),
      ].filter(
        (text) =>
          !active.block.text.includes(text) && !active.note.text.includes(text),
      )
    : [];
  let number = 0;
  return (
    <div
      className="profile-introduction"
      data-profile-introduction={introduction.person}
    >
      {introduction.blocks.map((block) => (
        <div key={block.passage} data-profile-passage={block.passage}>
          <p className="kin-life-intro">
            {introductionDisplayRuns(block).map((run, i) => {
              const sourceButton = (
                note: ProfileNote,
                grouped: boolean,
                key: number,
              ) => {
                const label = ++number;
                return (
                  <button
                    key={key}
                    className="profile-source-marker"
                    data-profile-source-anchor={note.anchor}
                    aria-label={`Read source note ${label}`}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      setActive({ block, note });
                    }}
                  >
                    {grouped ? label : `[${label}]`}
                  </button>
                );
              };
              if ('text' in run) return run.text;
              if ('register' in run)
                return (
                  <a
                    key={i}
                    className="profile-register-link"
                    href={`#view=book&bookAnchor=${run.register.anchor}`}
                    aria-label={`${run.label}: read ${run.register.label}’s entry in the book`}
                    onClick={(event) => {
                      event.preventDefault();
                      onReadBook(run.register.anchor);
                    }}
                  >
                    {run.label}
                  </a>
                );
              if ('group' in run)
                return (
                  <span key={i} className="profile-source-group">
                    {run.group.map((part, index) =>
                      'text' in part ? (
                        <span key={index} className="profile-source-separator">
                          {part.text}
                        </span>
                      ) : (
                        sourceButton(part.note, true, index)
                      ),
                    )}
                  </span>
                );
              return sourceButton(run.note, false, i);
            })}
          </p>
        </div>
      ))}
      <nav className="profile-chapter-links" aria-label="Read more in the book">
        {[...new Set(introduction.blocks.map((b) => b.section))].map(
          (section) => (
            <button
              className="kin-text-link profile-read-chapter"
              key={section}
              onClick={() => onReadBook(section)}
            >
              <BookOpenTextIcon size={18} aria-hidden="true" />
              <span>
                Read{' '}
                {sections.find((s) => s.anchor === section)?.title ??
                  'this section'}
              </span>
              <ArrowRightIcon size={18} aria-hidden="true" />
            </button>
          ),
        )}
      </nav>
      {active && (
        <Modal
          label="Source note"
          initialFocusSelector="h2"
          className="profile-source-modal"
          returnFocus={() => trigger.current}
          onClose={() => setActive(null)}
        >
          <h2 tabIndex={-1}>Source note</h2>
          <SourceCitationPresentation presentations={presentations}>
            <p className="profile-source-copy">{active.note.text}</p>
            {context.length > 0 && (
              <div
                className="profile-source-context"
                aria-label="Context from the book"
              >
                {context.map((text) => (
                  <p key={text}>{readerQualification(text)}</p>
                ))}
              </div>
            )}
          </SourceCitationPresentation>
          <div className="profile-source-actions">
            {documents.map((document) => (
              <button
                className="kin-text-link"
                key={document.id + ':' + (document.selectedUse?.id || '')}
                onClick={() => onDocument(document, active.note)}
              >
                {document.bookMatch === 'citation'
                  ? 'See the record'
                  : 'See a related file'}{' '}
                <ArrowRightIcon size={18} />
              </button>
            ))}
            {onAlbum &&
              albums.map((album) => (
                <button
                  className="kin-text-link"
                  key={album.id}
                  onClick={() => onAlbum(album.id)}
                >
                  Listen to the album <ArrowRightIcon size={18} />
                </button>
              ))}
            <button
              className="kin-text-link"
              onClick={() =>
                onReadBook(active.block.section, active.note.anchor)
              }
            >
              Read this note in the book <ArrowRightIcon size={18} />
            </button>
            <button
              className="kin-text-link"
              data-dismiss-modal
              onClick={() => setActive(null)}
            >
              Return to profile
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
