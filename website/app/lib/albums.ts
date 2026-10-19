import catalogue from '@content/albums.json' with { type: 'json' };
import type { AtlasData, Source } from './gedcom.ts';
import { safeRelativePath } from './local-assets.ts';
import { listeningAudio, originalAudio } from './archive.ts';

import type { AlbumDefinition } from './content-types.ts';

export type { AlbumDefinition };
export type Album = AlbumDefinition & { sourceRecord: Source };

/** A sound file a browser can play, any sound file, and the artwork's
 * original: a scan as a PDF or a picture. */
const playable = (path: string) =>
  listeningAudio.test(path) || /\.(wav|flac)$/i.test(path);
const audio = (path: string) =>
  listeningAudio.test(path) || originalAudio.test(path);
const artworkOriginal = /\.(pdf|png|jpe?g|webp|tiff?)$/i;

/** Presentation metadata cannot admit a file or source into an edition. Every
 * endpoint must already belong to its selected canonical archive source. A
 * track's original may be its listening file when the family has only one. */
export function albumsInEdition(
  data: AtlasData,
  definitions: AlbumDefinition[] = catalogue,
): Album[] {
  return definitions.flatMap((album) => {
    const source = data.sources.find((s) => s.pointer === album.source);
    if (!source || !data.people.some((p) => p.id === album.person)) return [];
    const declared = new Set(source.archives.map((f) => f.path));
    const paths = [
      album.cover,
      ...album.tracks.flatMap((t) => [t.audio, t.original]),
      ...album.artwork.flatMap((a) => [a.image, a.original]),
    ];
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(album.id) ||
      !album.tracks.length ||
      !album.artwork.length ||
      !paths.every(
        (p) =>
          p.startsWith('images/') &&
          safeRelativePath(p) === p &&
          declared.has(p),
      ) ||
      !album.artwork.some((a) => a.image === album.cover) ||
      !album.artwork.every(
        (a) =>
          /\.(png|jpe?g|webp)$/i.test(a.image) &&
          artworkOriginal.test(a.original),
      ) ||
      new Set(album.tracks.map((t) => t.audio)).size !== album.tracks.length ||
      new Set(album.tracks.map((t) => t.original)).size !==
        album.tracks.length ||
      !album.tracks.every(
        (t, i) =>
          t.number === i + 1 &&
          Number.isFinite(t.duration) &&
          t.duration > 0 &&
          playable(t.audio) &&
          audio(t.original),
      )
    )
      return [];
    return [{ ...album, sourceRecord: source }];
  });
}

export function audioDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
