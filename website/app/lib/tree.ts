import type { AtlasData, Family, Person } from './gedcom.ts';
import { relationshipFinder } from './family-browsing.ts';

export type Direction = 'family' | 'ancestors' | 'descendants';
export const TREE_CARD_WIDTH = 248;
export const TREE_CARD_HEIGHT = 112;
const ROW = 136;
export interface TreeNode {
  id: string;
  x: number;
  y: number;
  generation: number;
}
export interface TreeLink {
  from: string;
  to: string;
  kind: 'parent' | 'partner';
  parentage?: string;
}

/** Named family circles, rather than an arbitrary graph-distance limit. */
function closeFamily(
  people: Map<string, Person>,
  focus: string,
  extended: boolean,
) {
  const levels = new Map<string, number>();
  const add = (id: string, generation: number) => {
    if (people.has(id) && !levels.has(id)) levels.set(id, generation);
  };
  const person = people.get(focus)!;
  const siblingsOf = (id: string) =>
    [
      ...new Set([
        ...(people.get(id)?.siblings || []),
        ...(people.get(id)?.parents || []).flatMap(
          (parent) => people.get(parent)?.children || [],
        ),
      ]),
    ].filter((sibling) => sibling !== id);
  const siblings = siblingsOf(focus);
  add(focus, 0);
  person.parents.forEach((id) => add(id, -1));
  siblings.forEach((id) => add(id, 0));
  person.children.forEach((id) => add(id, 1));
  if (extended) {
    for (const parentId of person.parents) {
      const parent = people.get(parentId);
      parent?.parents.forEach((id) => add(id, -2));
      for (const id of siblingsOf(parentId)) {
        add(id, -1);
        people.get(id)?.children.forEach((child) => add(child, 0));
      }
    }
    for (const id of siblings)
      people.get(id)?.children.forEach((child) => add(child, 1));
    for (const id of person.children)
      people.get(id)?.children.forEach((child) => add(child, 2));
  }
  // Add partners once. A relative's partner does not import a separate pedigree,
  // former/later partnership or unrelated children into this circle.
  const relatives = [...levels];
  for (const [id, generation] of relatives)
    people.get(id)?.partners.forEach((partner) => add(partner, generation));
  return levels;
}

/** Order each generation so parents sit beside their children and partners
 * stay together, which keeps connecting lines from crossing. A few
 * barycentre sweeps (down by parents, back up by children) are enough. */
function orderRows(rows: string[][], people: Map<string, Person>) {
  const units = (row: string[]) => {
    const seen = new Set<string>();
    const result: string[][] = [];
    for (const id of row) {
      if (seen.has(id)) continue;
      const unit = [
        id,
        ...(people.get(id)?.partners || []).filter(
          (partner) => row.includes(partner) && !seen.has(partner),
        ),
      ];
      unit.forEach((member) => seen.add(member));
      result.push(unit);
    }
    return result;
  };
  const sweep = (g: number, ref: number, kin: (p?: Person) => string[]) => {
    const at = new Map(rows[ref].map((id, i) => [id, i]));
    const scale = rows[ref].length / Math.max(1, rows[g].length);
    const scored = units(rows[g]).map((unit, i) => {
      const positions = unit
        .flatMap((id) => kin(people.get(id)))
        .filter((id) => at.has(id))
        .map((id) => at.get(id)!);
      const score = positions.length
        ? positions.reduce((a, b) => a + b, 0) / positions.length
        : rows[g].indexOf(unit[0]) * scale;
      return { unit, i, score };
    });
    scored.sort((a, b) => a.score - b.score || a.i - b.i);
    rows[g] = scored.flatMap((entry) => entry.unit);
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let g = 1; g < rows.length; g++)
      sweep(g, g - 1, (p) => p?.parents || []);
    for (let g = rows.length - 2; g >= 0; g--)
      sweep(g, g + 1, (p) => p?.children || []);
  }
}

export function familyLayout(
  data: AtlasData,
  focus: string,
  direction: Direction,
  depth: number,
) {
  const people = new Map(data.people.map((p) => [p.id, p]));
  if (!people.has(focus))
    return {
      nodes: [] as TreeNode[],
      links: [] as TreeLink[],
      width: 500,
      height: 400,
    };
  const levels =
    direction === 'family'
      ? closeFamily(people, focus, depth >= 2)
      : new Map<string, number>([[focus, 0]]);
  const queue = [{ id: focus, generation: 0, distance: 0 }];
  if (direction !== 'family')
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.distance >= depth) continue;
      const person = people.get(item.id)!;
      const next = direction === 'ancestors' ? person.parents : person.children;
      const generation = item.generation + (direction === 'ancestors' ? -1 : 1);
      for (const id of next)
        if (people.has(id) && !levels.has(id)) {
          levels.set(id, generation);
          queue.push({ id, generation, distance: item.distance + 1 });
        }
    }
  const generations = [...new Set(levels.values())].sort((a, b) => a - b);
  // Start brothers and sisters in their recorded family order.
  const birthOrder = new Map<string, number>();
  for (const family of data.families)
    family.children.forEach((id, index) => birthOrder.set(id, index));
  const rows = generations.map((g) =>
    [...levels.entries()]
      .filter(([, level]) => level === g)
      .map(([id]) => id)
      .sort((a, b) => (birthOrder.get(a) ?? 99) - (birthOrder.get(b) ?? 99)),
  );
  orderRows(rows, people);
  const largest = Math.max(...rows.map((r) => r.length));
  const height = Math.max(400, largest * ROW + 80);
  const nodes: TreeNode[] = rows.flatMap((row, column) =>
    row.map((id, index) => ({
      id,
      generation: generations[column],
      x: column * 332 + 40,
      y: (height - row.length * ROW) / 2 + index * ROW,
    })),
  );
  const links: TreeLink[] = [];
  for (const id of levels.keys()) {
    const person = people.get(id)!;
    for (const parent of person.parents)
      if (levels.has(parent))
        links.push({
          from: parent,
          to: id,
          kind: 'parent',
          parentage: person.parentLinks.find((link) => link.id === parent)
            ?.kind,
        });
    for (const partner of person.partners)
      if (levels.has(partner) && id < partner)
        links.push({ from: id, to: partner, kind: 'partner' });
  }
  return { nodes, links, width: generations.length * 332 + 20, height };
}

export interface TreeFamilyGroup {
  id: string;
  title: string;
  context: string;
  parents: Person[];
  children: Person[];
  /** Only actual recorded events; not a statement of current marital status. */
  events: Family['events'];
}

/** Family cards preserve the source FAM grouping and each child's parentage. */
export function familyGroups(
  data: AtlasData,
  visibleIds: string[],
  focus: string,
) {
  const people = new Map(data.people.map((person) => [person.id, person]));
  const visible = new Set(visibleIds);
  const relationship = relationshipFinder(data, focus);
  const proximity = (id: string) => relationship(id)?.path.length ?? Infinity;
  const groups = data.families.flatMap((family) => {
    const parents = family.parents
      .filter((id) => visible.has(id) && people.has(id))
      .map((id) => people.get(id)!)
      .sort(
        (a, b) =>
          proximity(a.id) - proximity(b.id) || a.name.localeCompare(b.name),
      );
    const children = family.children
      .filter((id) => visible.has(id) && people.has(id))
      .map((id) => people.get(id)!);
    if (parents.length + children.length < 2 || !parents.length) return [];
    const hasFocusParent = parents.some((person) => person.id === focus);
    const hasFocusChild = children.some((person) => person.id === focus);
    const marriage = family.events.some((event) => event.type === 'MARR');
    const divorce = family.events.some((event) => event.type === 'DIV');
    const relative = parents[0];
    const relation = relationship(relative.id)?.label;
    return [
      {
        id: family.id,
        title: parents
          .map((person) => person.given.split(' ')[0] || person.name)
          .join(' and '),
        context: hasFocusParent
          ? children.length
            ? parents.length > 1
              ? marriage
                ? 'Spouse and children'
                : 'Partner and children'
              : 'Children'
            : marriage
              ? divorce
                ? 'Former spouses'
                : 'Spouses'
              : 'Partners'
          : hasFocusChild
            ? 'Parents and siblings'
            : relation
              ? `${relation}’s family`
              : 'Family',
        parents,
        children,
        events: family.events,
        order: hasFocusParent
          ? 0
          : hasFocusChild
            ? 1
            : 2 + Math.min(...parents.map((person) => proximity(person.id))),
      },
    ];
  });
  return groups
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map(({ order: _order, ...group }): TreeFamilyGroup => group);
}
