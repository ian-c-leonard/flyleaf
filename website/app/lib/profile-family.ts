import type { AtlasData, LifeEvent, Person } from './gedcom.ts';
import { formatGedcomDate } from './date-display.ts';

/** partnerId is copied from the same FAM as this event by the GEDCOM reader. */
export function profileEventLabel(event: LifeEvent, people: Person[]): string {
  if (event.type !== 'MARR') return event.label;
  const spouse = people.find((person) => person.id === event.partnerId);
  return spouse ? `Married to ${spouse.name}` : event.label;
}

export interface ProfileUnionResearch {
  /** Exact admitted source/citation identities, retained for original opening. */
  sourceId: string;
  useId: string;
  sourceLabel: string;
  locator: string;
  /** Exact citation-use annotations; never inferred from source-record notes. */
  notes: string[];
}

export interface ProfileUnion {
  familyId: string;
  person: Person;
  married: boolean;
  role: string;
  summary: string;
  /** Direct literal event cautions remain beside the recorded relationship. */
  details: string[];
  /** Source-specific evidence reasoning stays attributed and collapsible. */
  research: ProfileUnionResearch[];
}

/** Each row describes one recorded union, never its presumed present status. */
export function profileUnions(
  data: AtlasData,
  personId: string,
): ProfileUnion[] {
  const result: ProfileUnion[] = [];
  for (const family of data.families) {
    if (!family.parents.includes(personId)) continue;
    const marriage = family.events.find((event) => event.type === 'MARR');
    const divorce = family.events.find((event) => event.type === 'DIV');
    const research = data.sources.flatMap((source) =>
      (source.uses || [])
        .filter((use) =>
          use.placements.some((placement) =>
            [placement, ...placement.via].some(
              (address) =>
                address.record === family.id &&
                address.path.some(({ tag }) => tag === 'MARR' || tag === 'DIV'),
            ),
          ),
        )
        .map((use) => ({
          sourceId: source.id,
          useId: use.id,
          sourceLabel: source.label,
          locator: use.locator,
          notes: [...use.notes],
        })),
    );
    for (const partnerId of family.parents.filter((id) => id !== personId)) {
      const partner = data.people.find((person) => person.id === partnerId);
      if (!partner) continue;
      const role = marriage
        ? partner.sex === 'F'
          ? 'Wife'
          : partner.sex === 'M'
            ? 'Husband'
            : 'Spouse'
        : 'Partner';
      const summaries = marriage
        ? [
            [
              marriage.date
                ? `Married ${formatGedcomDate(marriage.date, true)}`
                : 'Married',
              marriage.place?.name,
            ]
              .filter(Boolean)
              .join(' · '),
          ]
        : [];
      if (divorce)
        summaries.push(
          [
            divorce.date
              ? `Divorced ${formatGedcomDate(divorce.date, true)}`
              : 'Divorced',
            divorce.place?.name,
          ]
            .filter(Boolean)
            .join(' · '),
        );
      result.push({
        familyId: family.id,
        person: partner,
        married: !!marriage,
        role,
        summary: summaries.join(' · '),
        details: [
          ...new Set(
            family.events.map((event) => event.detail).filter(Boolean),
          ),
        ],
        research,
      });
    }
  }
  return result;
}
