import { lifespan, type Person } from './gedcom.ts';
import { citationUseLabel, type CitationUse } from './citation-uses.ts';

/** Distinguish equal owner names without changing citation identity or notes. */
export function citationDisplayLabel(
  use: CitationUse,
  uses: CitationUse[],
  people: Person[],
) {
  const label = citationUseLabel({
    ...use,
    placements: use.placements.map((placement) => ({
      ...placement,
      label:
        placement.label === 'General note reference'
          ? 'Family history reference'
          : placement.label,
    })),
  });
  const namesakes = uses.filter(
    (other) =>
      other.owner.label === use.owner.label &&
      other.owner.pointer !== use.owner.pointer,
  );
  if (!namesakes.length) return label;
  const owners = (item: CitationUse) =>
    item.owner.people.flatMap((id) => {
      const person = people.find((person) => person.id === id);
      return person ? [person] : [];
    });
  const dates = (item: CitationUse) =>
    owners(item)
      .map((person) => lifespan(person))
      .filter(Boolean)
      .join('; ');
  const parents = (item: CitationUse) =>
    owners(item)
      .map((person) => {
        const names = person.parents.flatMap((id) => {
          const name = people.find((parent) => parent.id === id)?.name;
          return name ? [name] : [];
        });
        if (!names.length) return '';
        const role =
          person.sex === 'M'
            ? 'son'
            : person.sex === 'F'
              ? 'daughter'
              : 'child';
        return `${role} of ${names.join(' and ')}`;
      })
      .filter(Boolean)
      .join('; ');
  // Prefer a detail a reader recognizes. Never show an internal record pointer.
  const distinct = (detail: (item: CitationUse) => string) => {
    const own = detail(use);
    return own && namesakes.every((other) => detail(other) !== own) ? own : '';
  };
  const order = [
    ...new Set([use, ...namesakes].map((item) => item.owner.pointer)),
  ].sort();
  const position = order.indexOf(use.owner.pointer);
  const ordinal =
    ['first', 'second', 'third', 'fourth', 'fifth'][position] ||
    `number ${position + 1}`;
  const detail =
    distinct(dates) || distinct(parents) || `${ordinal} of this name`;
  return use.owner.label + ` (${detail})` + label.slice(use.owner.label.length);
}
