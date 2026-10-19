// A family's content files name people by id: name aliases, collections,
// place readings, albums and the recipe book. The site build keeps only the
// entries about people in the published tree, so a public site carries no
// names or ids for people the tree leaves out (vite.config.ts).

type Entry = Record<string, unknown>;

const list = (value: unknown): Entry[] =>
  Array.isArray(value) ? (value as Entry[]) : [];
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];

/** The content file with entries about unpublished people removed, and a
 * line for each removed entry. Files that name no one come back unchanged. */
export function publishedContent(
  name: string,
  value: unknown,
  people: ReadonlySet<string>,
  recipePerson = '',
): { value: unknown; removed: string[] } {
  const removed: string[] = [];
  const keep = (label: string, named: string[]) => {
    const outside = named.filter((id) => !people.has(id));
    if (outside.length) removed.push(`${label} (${outside.join(', ')})`);
    return !outside.length;
  };
  if (name === 'name-aliases.json' && value && typeof value === 'object') {
    const file = value as { aliases?: Record<string, unknown> };
    const aliases = Object.fromEntries(
      Object.entries(file.aliases || {}).filter(([id]) =>
        keep(`other names for ${id}`, [id]),
      ),
    );
    return { value: { ...file, aliases }, removed };
  }
  if (name === 'family-collections.json' || name === 'place-readings.json') {
    const kind =
      name === 'family-collections.json' ? 'collection' : 'place reading';
    return {
      value: list(value).filter((entry) =>
        keep(
          `${kind} ${text(entry.id) || text(entry.place)}`.trim(),
          ids(entry.people),
        ),
      ),
      removed,
    };
  }
  if (name === 'albums.json')
    return {
      value: list(value).filter((album) =>
        keep(`album ${text(album.id)}`, ids([album.person])),
      ),
      removed,
    };
  // The recipe index lists the recipe book's recipes and their credits, so
  // with no recipe book, or none that names its person, it shows nothing.
  if (name === 'recipe-index.json' && !recipePerson) {
    const index = (value || {}) as Entry;
    if (list(index.recipes).length)
      removed.push('the recipe index (no recipe book names its person)');
    return { value: { ...index, volumes: {}, recipes: [] }, removed };
  }
  // The recipe book and its index belong to one person.
  if (name === 'family-recipes.json' || name === 'recipe-index.json') {
    const person =
      name === 'family-recipes.json'
        ? (value as { labels?: { person?: unknown } } | null)?.labels?.person
        : recipePerson;
    const label =
      name === 'family-recipes.json' ? 'recipe book' : 'recipe index';
    if (typeof person === 'string' && person && !keep(label, [person]))
      return {
        value:
          name === 'family-recipes.json'
            ? null
            : { ...(value as Entry), volumes: {}, recipes: [] },
        removed,
      };
  }
  return { value, removed };
}
