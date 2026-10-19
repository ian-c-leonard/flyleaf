import { useState } from 'react';
import type { Person } from '../lib/gedcom';
import type { ArchiveDocument } from '../lib/archive';
import type { CitationUse } from '../lib/citation-uses';
import { citationDisplayLabel } from '../lib/citation-labels';

export default function CitationUses({
  source,
  choices,
  people,
  scopeLabel,
  onSelect,
}: {
  source: ArchiveDocument;
  choices: CitationUse[];
  people: Person[];
  scopeLabel: string;
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const uses = source.uses || [];
  const selected = source.selectedUse;
  const label = (use: CitationUse) => citationDisplayLabel(use, uses, people);
  const offered = all ? uses : choices;
  const options =
    selected && !offered.some((use) => use.id === selected.id)
      ? [selected, ...offered]
      : offered;
  if (!uses.length && !source.unavailableUse) return null;
  const names =
    selected?.owner.people.flatMap((id) => {
      const name = people.find((person) => person.id === id)?.name;
      return name ? [name] : [];
    }) || [];
  return (
    <section className="document-citation-uses">
      <h3>What this record tells us</h3>
      {source.unavailableUse && (
        <output>
          That reference is no longer here. Choose another one below.
          <button
            className="citation-scope-toggle"
            onClick={() => onSelect('')}
          >
            Show the overview
          </button>
        </output>
      )}
      {!!uses.length && (
        <>
          <label>
            Choose a reference
            <select
              value={selected?.id || ''}
              onChange={(event) => onSelect(event.target.value)}
            >
              <option value="">Overview</option>
              {options.map((use) => (
                <option key={use.id} value={use.id}>
                  {label(use)}
                </option>
              ))}
            </select>
          </label>
          {!selected && <p>Choose a reference to read its notes.</p>}
          {choices.length < uses.length && (
            <button
              className="citation-scope-toggle"
              onClick={() => setAll(!all)}
            >
              {all
                ? `Show references for ${scopeLabel}`
                : 'Show references for the whole family'}
            </button>
          )}
        </>
      )}
      {selected && (
        <div className="document-use-note" data-citation-use={selected.id}>
          <h4>{label(selected)}</h4>
          {!choices.some((use) => use.id === selected.id) && (
            <p className="document-use-context">
              This reference belongs to another part of the family.
            </p>
          )}
          {selected.owner.kind !== 'INDI' && names.length > 0 && (
            <p className="document-use-context">
              Linked with {names.join(', ')}.
            </p>
          )}
          {selected.notes.some(Boolean) ? (
            selected.notes.map((note, index) => (
              <p className="citation-qualification" key={index}>
                {note}
              </p>
            ))
          ) : (
            <p>No notes for this reference.</p>
          )}
        </div>
      )}
    </section>
  );
}
