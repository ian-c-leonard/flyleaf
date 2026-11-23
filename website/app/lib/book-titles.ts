/** A family album or collection that the book names by its title, so the
 * title in the text can open the thing itself. */
export type TitleTarget = { kind: 'album' | 'collection'; id: string };

type Titled = { id: string; title: string };

/** Titles are compared without regard to case, spacing or the style of an
 * apostrophe: the book prints "Meemaw’s" where a file may hold "Meemaw's". */
export function plainTitle(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The titles that can be opened. A title claimed by two different things
 * opens neither, because the text alone cannot say which is meant. */
export function titleTargets(
  albums: Titled[],
  collections: Titled[],
): Map<string, TitleTarget> {
  const found = new Map<string, TitleTarget>();
  const twice = new Set<string>();
  const add = (kind: TitleTarget['kind'], item: Titled) => {
    const key = plainTitle(item.title);
    if (!key) return;
    if (found.has(key)) twice.add(key);
    else found.set(key, { kind, id: item.id });
  };
  for (const album of albums) add('album', album);
  for (const collection of collections) add('collection', collection);
  for (const key of twice) found.delete(key);
  return found;
}

/** The album or collection a piece of italic text names, if any. Only the
 * whole title counts: a title inside a longer phrase is left alone. */
export function titleTarget(
  targets: Map<string, TitleTarget>,
  text: string,
): TitleTarget | undefined {
  return targets.get(plainTitle(text));
}
