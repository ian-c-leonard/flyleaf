import type { AtlasData, Person } from './gedcom.ts';
import nameAliases from '@content/name-aliases.json' with { type: 'json' };

export interface FamilyRelationship {
  label: string;
  kind:
    | 'self'
    | 'ancestor'
    | 'descendant'
    | 'sibling'
    | 'aunt-uncle'
    | 'niece-nephew'
    | 'cousin'
    | 'partner';
  /** Ordered from the reference person to the relative; no inferred edges. */
  path: Person[];
  includesAdoptiveConnection: boolean;
}

type ParentPath = { ids: string[]; adopted: boolean };

function parentPaths(people: Map<string, Person>, start: string) {
  const paths = new Map<string, ParentPath>();
  if (!people.has(start)) return paths;
  const pending: ParentPath[] = [{ ids: [start], adopted: false }];
  for (let i = 0; i < pending.length; i++) {
    const path = pending[i];
    const id = path.ids[path.ids.length - 1];
    const previous = paths.get(id);
    if (
      previous &&
      (previous.ids.length < path.ids.length ||
        (previous.ids.length === path.ids.length &&
          (!previous.adopted || path.adopted)))
    )
      continue;
    paths.set(id, path);
    const person = people.get(id)!;
    for (const parent of person.parents)
      if (people.has(parent) && !path.ids.includes(parent))
        pending.push({
          ids: [...path.ids, parent],
          adopted:
            path.adopted ||
            person.parentLinks.some(
              (link) => link.id === parent && link.kind === 'adopted',
            ),
        });
  }
  return paths;
}

function gendered(
  person: Person,
  female: string,
  male: string,
  neutral: string,
) {
  return person.sex === 'F' ? female : person.sex === 'M' ? male : neutral;
}

function great(label: string, count: number) {
  return count === 0
    ? label
    : count === 1
      ? `Great-${label.toLowerCase()}`
      : `${count}× great-${label.toLowerCase()}`;
}

function ordinal(number: number) {
  const words = [
    'First',
    'Second',
    'Third',
    'Fourth',
    'Fifth',
    'Sixth',
    'Seventh',
    'Eighth',
    'Ninth',
    'Tenth',
  ];
  if (words[number - 1]) return words[number - 1];
  const tens = number % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : number % 10 === 1
        ? 'st'
        : number % 10 === 2
          ? 'nd'
          : number % 10 === 3
            ? 'rd'
            : 'th';
  return `${number}${suffix}`;
}

/** The people and families of one data set, indexed once and shared by
 * every relationship worked out from them. Each person's ancestry is walked
 * at most once. */
function familyIndex(data: AtlasData) {
  const people = new Map(data.people.map((person) => [person.id, person]));
  const families = new Map<string, AtlasData['families']>();
  for (const family of data.families)
    for (const id of family.parents)
      families.set(id, [...(families.get(id) || []), family]);
  // Each ancestor's path, and the ancestor's place in the walk.
  const ancestries = new Map<
    string,
    { paths: Map<string, ParentPath>; order: Map<string, number> }
  >();
  return {
    people,
    families,
    ancestry(id: string) {
      let found = ancestries.get(id);
      if (!found) {
        const paths = parentPaths(people, id);
        const order = new Map([...paths.keys()].map((key, i) => [key, i]));
        found = { paths, order };
        ancestries.set(id, found);
      }
      return found;
    },
  };
}
type FamilyIndex = ReturnType<typeof familyIndex>;

function ancestryRelationship(
  index: FamilyIndex,
  reference: string,
  target: string,
): FamilyRelationship | null {
  const { people } = index;
  const relative = people.get(target);
  if (!relative || !people.has(reference)) return null;
  const from = index.ancestry(reference);
  const to = index.ancestry(target).paths;
  // Look up the smaller ancestry in the larger one. Ties keep the order of
  // the reference person's own ancestry.
  const shared = (
    from.paths.size <= to.size
      ? [...from.paths].flatMap(([id, a]) => {
          const b = to.get(id);
          return b ? [{ id, a, b }] : [];
        })
      : [...to].flatMap(([id, b]) => {
          const a = from.paths.get(id);
          return a ? [{ id, a, b }] : [];
        })
  ).sort(
    (a, b) =>
      a.a.ids.length + a.b.ids.length - b.a.ids.length - b.b.ids.length ||
      Math.max(a.a.ids.length, a.b.ids.length) -
        Math.max(b.a.ids.length, b.b.ids.length) ||
      Number(a.a.adopted || a.b.adopted) - Number(b.a.adopted || b.b.adopted) ||
      from.order.get(a.id)! - from.order.get(b.id)!,
  );
  const common = shared[0];
  if (!common) return null;
  const up = common.a.ids.length - 1;
  const down = common.b.ids.length - 1;
  const path = [...common.a.ids, ...common.b.ids.slice(0, -1).reverse()].map(
    (id) => people.get(id)!,
  );
  const adopted = common.a.adopted || common.b.adopted;
  let label: string;
  let kind: FamilyRelationship['kind'];
  if (up === 0 && down === 0) {
    kind = 'self';
    label = 'Self';
  } else if (down === 0) {
    kind = 'ancestor';
    label =
      up === 1
        ? gendered(relative, 'Mother', 'Father', 'Parent')
        : great(
            gendered(relative, 'Grandmother', 'Grandfather', 'Grandparent'),
            up - 2,
          );
  } else if (up === 0) {
    kind = 'descendant';
    label =
      down === 1
        ? gendered(relative, 'Daughter', 'Son', 'Child')
        : great(
            gendered(relative, 'Granddaughter', 'Grandson', 'Grandchild'),
            down - 2,
          );
  } else if (up === 1 && down === 1) {
    kind = 'sibling';
    const ownParents = people.get(reference)!.parents;
    const shared = ownParents.filter((id) => relative.parents.includes(id));
    // One recorded parent alone cannot establish that siblings are half-siblings.
    const half =
      !adopted &&
      shared.length === 1 &&
      ownParents.length === 2 &&
      relative.parents.length === 2 &&
      ![...people.get(reference)!.parentLinks, ...relative.parentLinks].some(
        (link) => ['adopted', 'foster', 'sealing'].includes(link.kind),
      );
    const sibling = gendered(relative, 'Sister', 'Brother', 'Sibling');
    label = half ? `Half-${sibling.toLowerCase()}` : sibling;
  } else if (down === 1) {
    kind = 'aunt-uncle';
    label = great(gendered(relative, 'Aunt', 'Uncle', 'Aunt or uncle'), up - 2);
  } else if (up === 1) {
    kind = 'niece-nephew';
    label = great(
      gendered(relative, 'Niece', 'Nephew', 'Niece or nephew'),
      down - 2,
    );
  } else {
    kind = 'cousin';
    const removed = Math.abs(up - down);
    label = `${ordinal(Math.min(up, down) - 1)} cousin${
      removed === 0
        ? ''
        : removed === 1
          ? ' once removed'
          : removed === 2
            ? ' twice removed'
            : ` ${removed} times removed`
    }`;
  }
  return {
    label: adopted ? `${label} (by adoption)` : label,
    kind,
    path,
    includesAdoptiveConnection: adopted,
  };
}

function unionLabel(index: FamilyIndex, person: Person, partnerId: string) {
  const families = (index.families.get(person.id) || []).filter((family) =>
    family.parents.includes(partnerId),
  );
  const marriage = families.some((family) =>
    family.events.some((event) => event.type === 'MARR'),
  );
  if (!marriage) return 'Partner';
  const spouse =
    person.sex === 'F' ? 'Wife' : person.sex === 'M' ? 'Husband' : 'Spouse';
  return families.some((family) =>
    family.events.some((event) => event.type === 'DIV'),
  )
    ? `Former ${spouse.toLowerCase()}`
    : spouse;
}

function relationshipWith(
  index: FamilyIndex,
  targetId: string,
  referenceId: string,
): FamilyRelationship | null {
  const { people } = index;
  const reference = people.get(referenceId);
  const target = people.get(targetId);
  if (!reference || !target) return null;
  const direct = ancestryRelationship(index, referenceId, targetId);
  if (direct) return direct;
  if (reference.partners.includes(targetId))
    return {
      label: unionLabel(index, target, referenceId),
      kind: 'partner',
      path: [reference, target],
      includesAdoptiveConnection: false,
    };
  const choices: FamilyRelationship[] = [];
  for (const partner of target.partners) {
    const relation = ancestryRelationship(index, referenceId, partner);
    if (relation && !relation.path.some((person) => person.id === targetId))
      choices.push({
        label: `${relation.label}’s ${unionLabel(index, target, partner).toLowerCase()}`,
        kind: 'partner',
        path: [...relation.path, target],
        includesAdoptiveConnection: relation.includesAdoptiveConnection,
      });
  }
  for (const partner of reference.partners) {
    const relation = ancestryRelationship(index, partner, targetId);
    if (relation && !relation.path.some((person) => person.id === referenceId))
      choices.push({
        label: `${unionLabel(index, people.get(partner)!, referenceId)}’s ${relation.label.toLowerCase()}`,
        kind: 'partner',
        path: [reference, ...relation.path],
        includesAdoptiveConnection: relation.includesAdoptiveConnection,
      });
  }
  return choices.sort((a, b) => a.path.length - b.path.length)[0] || null;
}

export type RelationshipFinder = (
  targetId: string,
) => FamilyRelationship | null;

/** Everyone's relationship to one reference person. Make one finder per
 * reference person and data set: it indexes the family once and works out
 * each relationship once, however often it is asked. */
export function relationshipFinder(
  data: AtlasData,
  referenceId = data.rootId,
): RelationshipFinder {
  const index = familyIndex(data);
  const found = new Map<string, FamilyRelationship | null>();
  return (targetId) => {
    if (!found.has(targetId))
      found.set(targetId, relationshipWith(index, targetId, referenceId));
    return found.get(targetId)!;
  };
}

/** A recorded family relationship, including collateral relatives and partners.
 * Marriage/divorce labels describe recorded events, not verified current status.
 * Possible-identity associations and surname resemblance never create a path.
 * For many people, use one relationshipFinder instead.
 */
export function relationshipTo(
  data: AtlasData,
  targetId: string,
  referenceId = data.rootId,
): FamilyRelationship | null {
  return relationshipFinder(data, referenceId)(targetId);
}

// Names the family uses that the records do not, from content/name-aliases.json.
// Other aliases come only from recorded name metadata.
const acceptedFamilyNames: Record<string, string[]> = nameAliases.aliases;

function normalized(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’‘ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

/** Build once for the full edition, then use the predicate in each family view.
 * Search includes recorded name variants, accepted family names, event places
 * and supported kinship. Partners' surnames are never assigned automatically.
 */
export function createPeopleSearch(
  data: AtlasData,
  referenceId = data.rootId,
  relationship = relationshipFinder(data, referenceId),
) {
  const entries = new Map(
    data.people.map((person) => {
      const fields = [
        person.name,
        person.given,
        person.surname,
        ...(person.nameVariants || []),
        ...(acceptedFamilyNames[person.id] || []),
        ...person.events.flatMap((event) =>
          event.place ? [event.place.name] : [],
        ),
        relationship(person.id)?.label || '',
      ].map(normalized);
      return [
        person.id,
        {
          text: fields.join(' '),
          compact: fields.map((f) => f.replace(/ /g, '')),
        },
      ] as const;
    }),
  );
  return (person: Person, query: string) => {
    const tokens = normalized(query).split(' ').filter(Boolean);
    if (!tokens.length) return true;
    const entry = entries.get(person.id);
    return (
      !!entry &&
      tokens.every(
        (token) =>
          entry.text.includes(token) ||
          entry.compact.some((field) => field.includes(token)),
      )
    );
  };
}
