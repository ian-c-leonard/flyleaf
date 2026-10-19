// The shapes of a family's site content files, imported as "@content/<file>".
// A family may leave any file out; Flyleaf then uses the empty version in
// website/content-defaults/.

export type AlbumTrack = {
  number: number;
  title: string;
  writingCredit: string;
  duration: number;
  audio: string;
  original: string;
  originalBytes: number;
};
export type AlbumCredit = { name: string; role: string };
export type AlbumArtwork = { title: string; image: string; original: string };
/** albums.json: family music, each album tied to one archive source. */
export type AlbumDefinition = {
  id: string;
  title: string;
  artist: string;
  person: string;
  source: string;
  introduction: string;
  artworkDate: string;
  cover: string;
  tracks: AlbumTrack[];
  performers: AlbumCredit[];
  production: AlbumCredit[];
  recording: string;
  artwork: AlbumArtwork[];
  /** What the album was issued on, such as "CD" or "cassette", for "the
   * original CD audio". Optional. */
  medium?: string;
};

/** display-copy.json: reader wording for reviewed book passages. */
export type DisplayCopy = { description: string; replacements: string[][] };

/** family-collections.json: curated entry points into archive sources. */
export type FamilyCollection = {
  id: string;
  title: string;
  description: string;
  source: string;
  people: string[];
};

/** home-records.json: records shown on the home page. */
export type HomeRecord = { path: string; title: string };

/** name-aliases.json: other names relatives use, by person id. */
export type NameAliases = {
  description: string;
  aliases: Record<string, string[]>;
};
