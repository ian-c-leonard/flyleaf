import type { ArchiveFile, Source } from './gedcom.ts';
import { safeRelativePath } from './local-assets.ts';

export type RecipeCategory = { label: string; heading: string; page: number };
export type RecipeVolume = {
  id: string;
  shortTitle: string;
  path: string;
  sha256: string;
  kind: 'letter' | 'volume';
  pages: number;
  contentsPages: number;
  summary: string;
  categories: RecipeCategory[];
};
/** The family's own words for its recipe collection. The letter labels are
 * needed only when the collection includes a letter. */
export type RecipeLabels = {
  title: string;
  person: string;
  byline: string;
  open: string;
  credit: string;
  compiledBy: string;
  searchPlaceholder: string;
  searchLabel: string;
  letter?: string;
  letterDetail?: string;
  letterContext?: string;
};
const labelNames = [
  'title',
  'person',
  'byline',
  'open',
  'credit',
  'compiledBy',
  'searchPlaceholder',
  'searchLabel',
] as const;
const letterLabelNames = ['letter', 'letterDetail', 'letterContext'] as const;
export type RecipeCatalog = {
  version: 1;
  source: string;
  /** The picture on the collection's card on Home. */
  coverImage: string;
  /** A picture of the letter, offered beside it, when there is one. */
  letterImage?: string;
  labels: RecipeLabels;
  volumes: RecipeVolume[];
};
export type AvailableRecipeVolume = RecipeVolume & { file: ArchiveFile };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid recipe contents');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Missing recipe contents label');
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error('Invalid recipe contents page');
  return value;
}

/** Authored navigation into unchanged PDFs, bound to their reviewed bytes.
 * It neither transcribes recipes nor assigns their authorship to the compiler. */
export function validateRecipeCatalog(value: unknown): RecipeCatalog {
  const root = object(value);
  if (root.version !== 1 || !Array.isArray(root.volumes))
    throw new Error('Unsupported recipe contents');
  const seenIds = new Set<string>(),
    seenPaths = new Set<string>();
  const volumes = root.volumes.map((raw): RecipeVolume => {
    const row = object(raw);
    const id = text(row.id),
      path = text(row.path),
      sha256 = text(row.sha256);
    if (
      seenIds.has(id) ||
      seenPaths.has(path) ||
      safeRelativePath(path) !== path ||
      !path.endsWith('.pdf') ||
      !/^[a-f\d]{64}$/.test(sha256) ||
      (row.kind !== 'letter' && row.kind !== 'volume') ||
      !Array.isArray(row.categories)
    )
      throw new Error('Invalid recipe volume identity');
    seenIds.add(id);
    seenPaths.add(path);
    const pages = integer(row.pages, 1, 10000);
    const contentsPages = integer(row.contentsPages, 0, pages);
    let previous = contentsPages;
    const labels = new Set<string>();
    const categories = row.categories.map((rawCategory): RecipeCategory => {
      const category = object(rawCategory);
      const label = text(category.label),
        heading = text(category.heading);
      const page = integer(category.page, 1, pages);
      // The final contents page can share a page with the first category.
      if (page < previous || labels.has(label))
        throw new Error(
          'Recipe categories must follow the original page order',
        );
      previous = page;
      labels.add(label);
      return { label, heading, page };
    });
    if (row.kind === 'letter' && (pages !== 1 || categories.length))
      throw new Error('The recipe letter is a single page, not a volume');
    return {
      id,
      path,
      sha256,
      kind: row.kind,
      pages,
      contentsPages,
      categories,
      shortTitle: text(row.shortTitle),
      summary: text(row.summary),
    };
  });
  const image = (value: unknown) => {
    const path = text(value);
    if (safeRelativePath(path) !== path)
      throw new Error('Invalid recipe image');
    return path;
  };
  // Older files name only a letterImage; it is the cover picture too.
  const coverImage = image(root.coverImage ?? root.letterImage);
  const letterImage =
    root.letterImage === undefined ? undefined : image(root.letterImage);
  const hasLetter = volumes.some((volume) => volume.kind === 'letter');
  const rawLabels = object(root.labels);
  const labels = Object.fromEntries(
    labelNames.map((name) => [name, text(rawLabels[name])]),
  ) as RecipeLabels;
  for (const name of letterLabelNames)
    if (hasLetter || rawLabels[name] !== undefined)
      labels[name] = text(rawLabels[name]);
  return {
    version: 1,
    source: text(root.source),
    coverImage,
    ...(letterImage ? { letterImage } : {}),
    labels,
    volumes,
  };
}

/** The family's recipe book (family-recipes.json), or null when it has none. */
export function familyRecipeBook(value: unknown): RecipeCatalog | null {
  return value === null ? null : validateRecipeCatalog(value);
}

/** Only offer files retained on this canonical source in this edition. */
export function recipeVolumesForSource(
  source: Source,
  catalog: RecipeCatalog,
): AvailableRecipeVolume[] {
  if (source.pointer !== catalog.source) return [];
  return catalog.volumes.flatMap((volume) => {
    const file = source.archives.find(
      (candidate) => candidate.path === volume.path,
    );
    return file ? [{ ...volume, file }] : [];
  });
}

export function recipeCategoryAtPage(
  volume: RecipeVolume,
  page: number,
): RecipeCategory | null {
  return (
    volume.categories.findLast((category) => category.page <= page) || null
  );
}

export type RecipeEntry = {
  name: string;
  volume: string;
  page: number;
  credit?: string;
};
export type RecipeIndex = {
  version: 1;
  volumes: Record<string, string>;
  recipes: RecipeEntry[];
};

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();

/** Recipes whose name, cook or category contains every word typed.
 * Names that start with the search come first. Only volumes whose PDF
 * matches the index are searched. */
export function searchRecipes(
  index: RecipeIndex,
  volumes: RecipeVolume[],
  query: string,
): (RecipeEntry & { category: string })[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const byId = new Map(
    volumes
      .filter((volume) => index.volumes[volume.id] === volume.sha256)
      .map((volume) => [volume.id, volume]),
  );
  const scored = [];
  for (const recipe of index.recipes) {
    const volume = byId.get(recipe.volume);
    if (!volume) continue;
    const category = recipeCategoryAtPage(volume, recipe.page)?.label || '';
    const name = fold(recipe.name);
    const haystack = ` ${name} ${fold(recipe.credit || '')} ${fold(category)}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const score = name.startsWith(words[0])
      ? 0
      : ` ${name}`.includes(` ${words[0]}`)
        ? 1
        : name.includes(words[0])
          ? 2
          : 3;
    scored.push({ score, entry: { ...recipe, category } });
  }
  return scored
    .sort(
      (a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name),
    )
    .map(({ entry }) => entry);
}
