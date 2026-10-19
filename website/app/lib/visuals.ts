import type { Asset, AtlasData, GedNode } from './gedcom.ts';

/** One reviewed description per file; existing media captions stay separate. */
export interface VisualMedia {
  path: string;
  assetId: string;
  title: string;
  content: 'photograph' | 'artwork';
  album: 'display' | 'alternate';
  role: 'portrait' | 'group' | 'place' | 'object' | 'memorial';
  avatarEligible: boolean;
  avatarPosition: 'top' | 'center' | 'bottom';
  qualified: boolean;
  subjectIds: string[];
  associatedIds: string[];
  captionPeople: string[];
  commemoratedIds: string[];
  otherSubjects: string[];
  publicNote: string;
  note: string;
}

const relations = {
  _SUBJECT: 'subjectIds',
  _RELATED: 'associatedIds',
  _CAPTION_PERSON: 'captionPeople',
  _COMMEMORATES: 'commemoratedIds',
} as const;
const fields = new Set([
  ...Object.keys(relations),
  '_CONTENT',
  '_ALBUM',
  '_VISUAL_ROLE',
  '_AVATAR',
  '_DISCOVERY_NOTE',
  '_PUBLIC_NOTE',
  '_OTHER_SUBJECT',
  '_QUALIFIED',
  '_AVATAR_POSITION',
]);

/** This gate applies only to authored presentation captions, not original
 * records, transcriptions, source notes or private research instructions. A
 * GEDCOM pointer such as @I12@ in a caption is a working note, never words
 * for a reader. The build checks captions against the family's own phrases. */
function validatePublicCaption(text: string) {
  // The same pattern as the build's check (scripts/website_visuals.py).
  if (/@[^@\s]+@/.test(text))
    throw new Error(
      'Public visual caption contains internal research instructions',
    );
}

export function collectVisuals(
  records: GedNode[],
  people: Map<string, string>,
  addAssets: (node: GedNode) => string[],
): VisualMedia[] {
  const found: VisualMedia[] = [];
  const paths = new Set<string>();
  const walk = (node: GedNode, parent?: GedNode) => {
    if (fields.has(node.tag) && parent?.tag !== 'OBJE')
      throw new Error(`Visual metadata must belong to an OBJE: ${node.tag}`);
    if (node.tag === 'OBJE' && node.children.some((c) => fields.has(c.tag))) {
      if (node.value)
        throw new Error(
          'Visual metadata belongs on the media object, not its reference',
        );
      const many = (tag: string) => node.children.filter((n) => n.tag === tag);
      const one = (tag: string, required = false) => {
        const values = many(tag);
        if (values.length > 1 || (required && !values[0]?.value.trim()))
          throw new Error(`Visual media requires one ${tag}`);
        return values[0]?.value.trim() || '';
      };
      const path = one('FILE', true).replace(/\\/g, '/');
      if (
        path !== many('FILE')[0].value ||
        !path.startsWith('images/') ||
        path.split('/').some((part) => ['', '.', '..'].includes(part))
      )
        throw new Error(
          'Visual media requires a canonical relative images path',
        );
      if (!/\.(jpe?g|png|webp|gif)$/i.test(path))
        throw new Error('Visual media requires a supported raster file');
      if (paths.has(path))
        throw new Error(
          `Only one visual description is allowed per file: ${path}`,
        );
      const hashes = many('FILE')[0].children.filter(
        (n) => n.tag === '_SHA256',
      );
      if (hashes.length !== 1 || !/^[a-f0-9]{64}$/.test(hashes[0].value))
        throw new Error('Visual media requires one reviewed FILE SHA-256');
      const content = one('_CONTENT', true),
        album = one('_ALBUM', true),
        role = one('_VISUAL_ROLE', true),
        avatar = one('_AVATAR'),
        qualified = one('_QUALIFIED');
      const publicNote = one('_PUBLIC_NOTE');
      const title = one('TITL', true);
      const otherSubjects = many('_OTHER_SUBJECT').map((n) => n.value);
      validatePublicCaption(title);
      validatePublicCaption(publicNote);
      otherSubjects.forEach(validatePublicCaption);
      const position = one('_AVATAR_POSITION');
      if (
        position &&
        (!avatar || !['top', 'center', 'bottom'].includes(position))
      )
        throw new Error(
          'Avatar position requires approval and top, center or bottom',
        );
      if (!['photograph', 'artwork'].includes(content))
        throw new Error('Unknown visual medium');
      if (!['display', 'alternate'].includes(album))
        throw new Error('Visual media requires an explicit album selection');
      if (!['portrait', 'group', 'place', 'object', 'memorial'].includes(role))
        throw new Error('Unknown visual role');
      if (![avatar, qualified].every((v) => v === '' || v === 'Y'))
        throw new Error('Visual flags accept only Y or absence');
      const identified = (tag: keyof typeof relations) => {
        const nodes = many(tag);
        const values = nodes.map((n) => people.get(n.value));
        if (values.some((v) => !v) || nodes.some((n) => n.children.length))
          throw new Error(
            `Visual relation must identify an individual: ${tag}`,
          );
        if (new Set(values).size !== values.length)
          throw new Error(`Duplicate visual person relation: ${tag}`);
        return values as string[];
      };
      const subjectIds = identified('_SUBJECT');
      if (
        avatar &&
        (role !== 'portrait' || qualified || subjectIds.length !== 1)
      )
        throw new Error(
          'Avatar approval requires one identified, unqualified portrait',
        );
      const description: VisualMedia = {
        path,
        assetId: '',
        title,
        content: content as VisualMedia['content'],
        album: album as VisualMedia['album'],
        role: role as VisualMedia['role'],
        avatarEligible: avatar === 'Y',
        avatarPosition: (position || 'top') as VisualMedia['avatarPosition'],
        qualified: qualified === 'Y',
        subjectIds,
        associatedIds: identified('_RELATED'),
        captionPeople: identified('_CAPTION_PERSON'),
        commemoratedIds: identified('_COMMEMORATES'),
        otherSubjects,
        publicNote,
        note: one('_DISCOVERY_NOTE'),
      };
      description.assetId = addAssets(node)[0];
      if (!description.assetId)
        throw new Error('A visual description has no media asset');
      found.push(description);
      paths.add(path);
    }
    for (const c of node.children) walk(c, node);
  };
  for (const record of records) walk(record);
  return found;
}

export const visualFor = (data: AtlasData, path: string) =>
  data.visuals?.find((v) => v.path === path);
export const visualPeople = (visual: VisualMedia) => [
  ...new Set([
    ...visual.subjectIds,
    ...visual.associatedIds,
    ...visual.captionPeople,
    ...visual.commemoratedIds,
  ]),
];

export function albumPictures(data: AtlasData): Asset[] {
  const assets = new Map(data.assets.map((a) => [a.id, a]));
  return (data.visuals || [])
    .filter((v) => v.album === 'display')
    .flatMap((v) => (assets.has(v.assetId) ? [assets.get(v.assetId)!] : []));
}

/** Items with a picture, pictures of people (portraits and groups) first,
 * each group in its own order: the home page opens on a face. */
export function peopleFirst<T extends { image: string }>(
  data: AtlasData,
  items: readonly T[],
): T[] {
  const ofPeople = (item: T) =>
    ['portrait', 'group'].includes(visualFor(data, item.image)?.role ?? '');
  return [
    ...items.filter((item) => item.image && ofPeople(item)),
    ...items.filter((item) => item.image && !ofPeople(item)),
  ];
}

export function identifiedPortrait(
  data: AtlasData,
  personId: string,
): Asset | undefined {
  const visual = data.visuals?.find(
    (v) =>
      v.avatarEligible &&
      !v.qualified &&
      v.role === 'portrait' &&
      v.subjectIds.length === 1 &&
      v.subjectIds[0] === personId,
  );
  return visual && data.assets.find((a) => a.id === visual.assetId);
}

/** A painted portrait is useful for recognition without becoming a photograph.
 * Keep the medium in accessible image descriptions as well as the viewer. */
export function portraitDescription(data: AtlasData, asset: Asset): string {
  const visual = visualFor(data, asset.path);
  return visual ? `${visualLabel(visual)}: ${visual.title}` : asset.title;
}

export interface PersonGalleryEntry {
  asset: Asset;
  visual: VisualMedia;
  label: string;
}

export interface PersonGallery {
  depicted: PersonGalleryEntry[];
  captioned: PersonGalleryEntry[];
  related: PersonGalleryEntry[];
  all: PersonGalleryEntry[];
}

/** Profile photographs describe the person before their wider source context.
 * A caption naming someone does not identify an isolated face, and a source
 * association or shared original does not make its subject the same person.
 * All display selections remain available; alternate scans stay in the archive. */
export function personGallery(
  data: AtlasData,
  personId: string,
): PersonGallery {
  const gallery: PersonGallery = {
    depicted: [],
    captioned: [],
    related: [],
    all: [],
  };
  const assets = new Map(data.assets.map((asset) => [asset.id, asset]));
  for (const visual of data.visuals || []) {
    if (visual.album !== 'display' || !visualPeople(visual).includes(personId))
      continue;
    const asset = assets.get(visual.assetId);
    if (!asset) continue;
    const entry = { asset, visual, label: visualLabel(visual) };
    if (!visual.qualified && visual.subjectIds.includes(personId))
      gallery.depicted.push(entry);
    else if (
      !visual.qualified &&
      visual.role === 'group' &&
      visual.captionPeople.includes(personId)
    )
      gallery.captioned.push(entry);
    else gallery.related.push(entry);
  }
  const priority = ({ visual }: PersonGalleryEntry) =>
    visual.avatarEligible
      ? 0
      : visual.role === 'portrait'
        ? 1
        : visual.role === 'group'
          ? 2
          : 3;
  const compare = (a: PersonGalleryEntry, b: PersonGalleryEntry) =>
    priority(a) - priority(b) ||
    a.visual.title.localeCompare(b.visual.title, 'en', { numeric: true }) ||
    a.visual.path.localeCompare(b.visual.path, 'en');
  for (const entries of [gallery.depicted, gallery.captioned, gallery.related])
    entries.sort(compare);
  gallery.all = [...gallery.depicted, ...gallery.captioned, ...gallery.related];
  return gallery;
}

/** Only the file and its recorded ancestors supply source context. Sibling
 * photographs sharing a source page are not additional subjects or owners. */
export function visualAncestorPaths(data: AtlasData, path: string) {
  const ancestors = new Set([path]);
  const pending = [path];
  while (pending.length) {
    const child = pending.pop()!;
    for (const r of data.representations || [])
      if (r.child === child && !ancestors.has(r.parent)) {
        ancestors.add(r.parent);
        pending.push(r.parent);
      }
  }
  return ancestors;
}

export function visualSources(data: AtlasData, path: string) {
  const ancestors = visualAncestorPaths(data, path);
  const ids = new Set(
    [...data.assets, ...(data.mediaCaptions || [])]
      .filter((a) => ancestors.has(a.path))
      .flatMap((a) => a.sourceIds || []),
  );
  return data.sources.filter(
    (s) => ids.has(s.id) || s.archives.some((a) => ancestors.has(a.path)),
  );
}

export function visualLabel(visual: VisualMedia) {
  if (visual.content === 'artwork')
    return visual.role === 'portrait' ? 'Portrait artwork' : 'Artwork';
  if (visual.qualified) {
    // A named group can have unassigned faces without becoming unrelated.
    // This medium label neither identifies a face nor approves a portrait.
    if (visual.role === 'group' && visual.captionPeople.length)
      return 'Group photograph';
    return 'Related photograph';
  }
  return 'Photograph';
}

/** Use captions and credits stay tied to the exact file, independently of its
 * shorter album title. Never borrow a sibling crop's caption. */
export function visualCaptions(data: AtlasData, path: string) {
  const seen = new Set<string>();
  return (data.mediaCaptions || data.assets)
    .filter((a) => a.path === path)
    .filter((a) => {
      const key = JSON.stringify([a.title, a.credit, a.rights]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
