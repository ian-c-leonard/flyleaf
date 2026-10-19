import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  TreeStructureIcon,
} from '@phosphor-icons/react';
import type { AtlasData, Person } from '../lib/gedcom';
import type { WebBookBody } from '../lib/native-book';
import { relationshipTo } from '../lib/family-browsing';
import {
  chapterConnections,
  chapterFamilyContext,
  chapterPathEdge,
} from '../lib/book-chapter-opening';
import '../book-chapter-opening.css';

type Opening = {
  id: string;
  version: string;
  host: HTMLElement;
  orientation: ReturnType<typeof chapterConnections>;
};

// Keep a deliberately explored connection on Back from the tree in this tab.
// Nothing is written to storage or shared between visitors/printed editions.
const selections = new Map<string, { section: string; person: string }>();

function ChapterGuide({
  opening,
  data,
  onPerson,
  onRead,
  onTree,
}: {
  opening: Opening;
  data: AtlasData;
  onPerson: (id: string, trigger: HTMLElement) => void;
  onRead: (anchor: string) => void;
  onTree?: (id: string, trigger: HTMLElement) => void;
}) {
  const { orientation, id } = opening;
  const selectionKey = opening.version + ':' + id;
  const remembered = selections.get(selectionKey);
  const [sectionId, setSectionId] = useState(
    orientation.sections.some(
      (entry) => entry.section.anchor === remembered?.section,
    )
      ? remembered!.section
      : orientation.initialSection,
  );
  const selected =
    orientation.sections.find((entry) => entry.section.anchor === sectionId) ||
    orientation.sections[0];
  const [personId, setPersonId] = useState(
    selected?.people.some((person) => person.id === remembered?.person)
      ? remembered!.person
      : selected?.initialPerson || '',
  );
  const person =
    selected?.people.find((member) => member.id === personId) ||
    selected?.people.find((member) => member.id === selected.initialPerson) ||
    selected?.people[0];
  const relation =
    person && orientation.reference
      ? relationshipTo(data, person.id, orientation.reference.id)
      : null;
  const family = chapterFamilyContext(data, person?.id || '');
  const openPerson = (member: Person, trigger: HTMLButtonElement) =>
    onPerson(member.id, trigger);
  const readLink = (
    anchor: string,
    event: React.MouseEvent<HTMLAnchorElement>,
  ) => {
    event.stopPropagation();
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    onRead(anchor);
  };
  if (!selected) return null;
  // Folded by default so each chapter opens with its text.
  return (
    <details className="book-chapter-explore">
      <summary>Explore this chapter’s families</summary>
      <section
        className="book-chapter-connections"
        aria-label="Explore this chapter's family connections"
      >
        <label htmlFor={'book-opening-section-' + id}>Choose a section</label>
        <div className="book-chapter-selector-row">
          <select
            id={'book-opening-section-' + id}
            value={selected.section.anchor}
            onChange={(event) => {
              const next = orientation.sections.find(
                (entry) => entry.section.anchor === event.target.value,
              );
              setSectionId(event.target.value);
              setPersonId(next?.initialPerson || '');
              selections.set(selectionKey, {
                section: event.target.value,
                person: next?.initialPerson || '',
              });
            }}
          >
            {orientation.sections.map(({ section }) => (
              <option key={section.anchor} value={section.anchor}>
                {section.title}
              </option>
            ))}
          </select>
          {(orientation.previous || orientation.next) && (
            <nav
              className="book-chapter-neighbours"
              aria-label="Neighbouring narrative chapters"
            >
              {orientation.previous && (
                <a
                  href={'#view=book&bookAnchor=' + orientation.previous.anchor}
                  title={orientation.previous.title}
                  aria-label={'Previous chapter: ' + orientation.previous.title}
                  onClick={(event) =>
                    readLink(orientation.previous!.anchor, event)
                  }
                >
                  <ArrowLeftIcon size={19} aria-hidden="true" />
                </a>
              )}
              {orientation.next && (
                <a
                  href={'#view=book&bookAnchor=' + orientation.next.anchor}
                  title={orientation.next.title}
                  aria-label={'Next chapter: ' + orientation.next.title}
                  onClick={(event) => readLink(orientation.next!.anchor, event)}
                >
                  <ArrowRightIcon size={19} aria-hidden="true" />
                </a>
              )}
            </nav>
          )}
        </div>
        {selected.people.length > 0 && (
          <fieldset
            className="book-chapter-person-choices"
            aria-label="Choose whose family connection to follow"
          >
            {selected.people.map((member) => (
              <button
                key={member.id}
                type="button"
                aria-pressed={member.id === person?.id}
                onClick={() => {
                  setPersonId(member.id);
                  selections.set(selectionKey, {
                    section: selected.section.anchor,
                    person: member.id,
                  });
                }}
              >
                {member.name}
              </button>
            ))}
          </fieldset>
        )}
        {relation && orientation.reference && (
          <div className="book-chapter-path">
            <output className="book-chapter-relation">
              {person?.id === orientation.reference.id
                ? 'The present generation'
                : `${relation.label} of ${orientation.reference.given.split(' ')[0]}`}
            </output>
            <ol
              aria-label={
                'Family connection from ' + orientation.reference.name
              }
            >
              {relation.path.map((member, index) => (
                <li key={member.id}>
                  {index > 0 && (
                    <span className="book-chapter-path-edge">
                      <ArrowRightIcon size={13} aria-hidden="true" />
                      {chapterPathEdge(relation.path[index - 1], member)}
                    </span>
                  )}
                  <button
                    type="button"
                    id={`book-opening-path-${id}-${selected.section.anchor}-${member.id}`}
                    aria-label={member.name}
                    title={member.name}
                    onClick={(event) => {
                      event.stopPropagation();
                      openPerson(member, event.currentTarget);
                    }}
                  >
                    {relation.path.filter(
                      (relative) =>
                        relative.given.split(' ')[0] ===
                        member.given.split(' ')[0],
                    ).length > 1
                      ? member.name
                      : member.given.split(' ')[0] || member.name}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {person &&
          Object.values(family).some((members) => members.length > 0) && (
            <details className="book-chapter-household">
              <summary>Close family</summary>
              <dl>
                {(['parents', 'partners', 'children', 'siblings'] as const).map(
                  (kind) =>
                    family[kind].length > 0 && (
                      <div key={kind}>
                        <dt>{kind[0].toUpperCase() + kind.slice(1)}</dt>
                        <dd>
                          {family[kind].map((member) => (
                            <button
                              type="button"
                              key={member.id}
                              id={`book-opening-family-${id}-${selected.section.anchor}-${kind}-${member.id}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openPerson(member, event.currentTarget);
                              }}
                            >
                              {member.name}
                            </button>
                          ))}
                        </dd>
                      </div>
                    ),
                )}
              </dl>
            </details>
          )}
        <div className="book-chapter-actions">
          <a
            href={'#view=book&bookAnchor=' + selected.section.anchor}
            onClick={(event) => readLink(selected.section.anchor, event)}
          >
            Read this section <ArrowRightIcon size={15} aria-hidden="true" />
          </a>
          {person && (
            <a
              href={
                '#view=tree&focus=' +
                encodeURIComponent(person.id) +
                '&branch=' +
                encodeURIComponent(person.id)
              }
              id={`book-opening-tree-${id}`}
              onClick={(event) => {
                event.stopPropagation();
                if (
                  onTree &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey &&
                  event.button === 0
                ) {
                  event.preventDefault();
                  onTree(person.id, event.currentTarget);
                }
              }}
            >
              <TreeStructureIcon size={15} aria-hidden="true" /> Explore the family tree
            </a>
          )}
        </div>
      </section>
    </details>
  );
}

/** A web orientation around the shared chapter heading. Original chart nodes
 * move intact into a disclosure; their IDs, captions and sources are unchanged. */
export default function BookChapterOpenings({
  content,
  body,
  data,
  onPerson,
  onRead,
  onTree,
}: {
  content: RefObject<HTMLDivElement | null>;
  body: WebBookBody;
  data: AtlasData;
  onPerson: (id: string, trigger: HTMLElement) => void;
  onRead: (anchor: string) => void;
  onTree?: (id: string, trigger: HTMLElement) => void;
}) {
  const [openings, setOpenings] = useState<Opening[]>([]);
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return;
    const headingPassages = new Map(
      [...root.querySelectorAll<HTMLElement>('h3[id]')].map((heading) => [
        heading.id,
        heading.dataset.bookPassage || '',
      ]),
    );
    const entries: Opening[] = [];
    const moved: { element: HTMLElement; marker: Comment }[] = [];
    const disclosures: HTMLDetailsElement[] = [];
    const headings = [...root.querySelectorAll<HTMLElement>('h2[id^="ch-"]')];
    for (const heading of headings) {
      const openingNodes: HTMLElement[] = [];
      for (
        let next = heading.nextElementSibling;
        next && !/^H[23]$/.test(next.tagName);
        next = next.nextElementSibling
      )
        if (next instanceof HTMLElement) openingNodes.push(next);
      const charts = openingNodes.filter((node) =>
        node.matches('figure.native-book-chart'),
      );
      if (charts.length) {
        const details = document.createElement('details');
        details.className = 'book-print-charts';
        details.dataset.readerDecoration = '';
        const summary = document.createElement('summary');
        summary.textContent = `Family charts (${charts.length})`;
        details.appendChild(summary);
        charts[0].parentNode?.insertBefore(details, charts[0]);
        const instruction = openingNodes.find(
          (node) =>
            node.tagName === 'P' &&
            node.textContent?.startsWith(
              'Numbers identify register entries. Lines run from parents to a child:',
            ),
        );
        for (const element of [
          ...(instruction ? [instruction] : []),
          ...charts,
        ]) {
          const marker = document.createComment(
            'original printed-chart position',
          );
          element.parentNode?.insertBefore(marker, element);
          moved.push({ element, marker });
          details.appendChild(element);
        }
        disclosures.push(details);
      }
      const orientation = chapterConnections(
        data,
        body,
        heading.id,
        headingPassages,
      );
      if (!orientation.sections.length) continue;
      const host = document.createElement('div');
      host.className = 'book-chapter-guide';
      host.dataset.readerDecoration = '';
      heading.classList.add('book-chapter-opening');
      heading.parentNode?.insertBefore(host, heading.nextSibling);
      entries.push({
        id: heading.id,
        version: body.pdfSha256,
        host,
        orientation,
      });
    }
    setOpenings(entries);
    return () => {
      moved.forEach(({ element, marker }) => marker.replaceWith(element));
      disclosures.forEach((details) => details.remove());
      entries.forEach((entry) => entry.host.remove());
      headings.forEach((heading) =>
        heading.classList.remove('book-chapter-opening'),
      );
    };
  }, [body, content, data]);
  return (
    <>
      {openings.map((opening) =>
        createPortal(
          <ChapterGuide
            opening={opening}
            data={data}
            onPerson={onPerson}
            onRead={onRead}
            onTree={onTree}
          />,
          opening.host,
          opening.id,
        ),
      )}
    </>
  );
}
