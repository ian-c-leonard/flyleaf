import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { albumsInEdition, type AlbumDefinition } from '../app/lib/albums.ts';
import { readRoute, routeHref, homeRoute } from '../app/lib/navigation.ts';

const folder = 'images/albums/kitchen-songs/';
const album: AlbumDefinition = {
  id: 'kitchen-songs',
  title: 'Kitchen Songs',
  artist: 'Joan Penhallow',
  person: 'joan-treloar',
  source: '@ALBUM@',
  introduction: 'Two songs Joan recorded at home.',
  artworkDate: 'Original artwork, 1995',
  cover: folder + 'front.png',
  tracks: [1, 2].map((number) => ({
    number,
    title: `Song ${number}`,
    writingCredit: 'Traditional',
    duration: 120 + number,
    audio: `${folder}0${number}.mp3`,
    original: `${folder}0${number}.wav`,
    originalBytes: 1000,
  })),
  performers: [{ name: 'Joan Penhallow', role: 'vocals' }],
  production: [],
  recording: 'Recorded at home.',
  artwork: [
    {
      title: 'Front',
      image: folder + 'front.png',
      original: folder + 'front.pdf',
    },
    {
      title: 'Back',
      image: folder + 'back.png',
      original: folder + 'back.pdf',
    },
  ],
};
const files = [
  ...album.tracks.flatMap((track) => [track.audio, track.original]),
  ...album.artwork.flatMap((artwork) => [artwork.image, artwork.original]),
];
const data = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @ALBUM@
0 @I1@ INDI
1 REFN joan-treloar
1 NAME Joan /Treloar/
0 @ALBUM@ SOUR
1 TITL Kitchen Songs, a home recording
${files.map((path) => `1 OBJE\n2 FILE ${path}`).join('\n')}
0 TRLR`);

void test('album presentation cannot admit an excluded source, person, file or external media URL', () => {
  assert.equal(albumsInEdition(data, [album]).length, 1);
  assert.equal(albumsInEdition({ ...data, sources: [] }, [album]).length, 0);
  assert.equal(
    albumsInEdition(
      {
        ...data,
        people: data.people.filter((p) => p.id !== 'joan-treloar'),
      },
      [album],
    ).length,
    0,
  );
  for (const path of [
    'https://example.org/music.mp3',
    'images/../private/music.mp3',
    'images/unlisted.mp3',
  ]) {
    const altered = structuredClone(album);
    altered.tracks[0].audio = path;
    assert.equal(albumsInEdition(data, [altered]).length, 0);
  }
  const missing = structuredClone(data);
  const source = missing.sources.find((s) => s.pointer === album.source)!;
  source.archives = source.archives.filter(
    (f) => f.path !== album.artwork[0].original,
  );
  assert.equal(albumsInEdition(missing, [album]).length, 0);
});

void test('album deep links and artwork panels round-trip; absent albums return safely home', () => {
  // Deep links read the family's own albums.json, so check whichever albums
  // the current family shows.
  const current = parseGedcom(
    readFileSync(new URL('../public/data/family.ged', import.meta.url), 'utf8'),
  );
  for (const shown of albumsInEdition(current)) {
    const route = {
      ...homeRoute,
      view: 'album' as const,
      album: shown.id,
      record: shown.sourceRecord.id,
      file: shown.artwork[1]?.image || shown.artwork[0].image,
    };
    const restored = readRoute(routeHref(route), current);
    for (const key of ['view', 'album', 'record', 'file'] as const)
      assert.equal(restored[key], route[key]);
    assert.equal(
      readRoute(routeHref(route), { ...current, sources: [] }).view,
      'home',
    );
  }
  for (const id of ['', 'missing', 'https://example.org']) {
    const invalid = readRoute(
      '#view=album&album=' + encodeURIComponent(id),
      current,
    );
    assert.equal(invalid.view, 'home');
    assert.equal(invalid.album, '');
  }
});

void test('an album may use any common sound format and scanned or photographed artwork', () => {
  const formats = (audio: string, original: string, artwork: string) => {
    const altered = structuredClone(album);
    altered.tracks.forEach((track) => {
      track.audio = track.audio.replace(/\.mp3$/, audio);
      track.original = track.original.replace(/\.wav$/, original);
    });
    altered.artwork.forEach((a) => {
      a.original = a.original.replace(/\.pdf$/, artwork);
    });
    const paths = [
      ...altered.tracks.flatMap((t) => [t.audio, t.original]),
      ...altered.artwork.flatMap((a) => [a.image, a.original]),
    ];
    const edition = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @ALBUM@
0 @I1@ INDI
1 REFN joan-treloar
1 NAME Joan /Treloar/
0 @ALBUM@ SOUR
1 TITL Kitchen Songs, a home recording
${[...new Set(paths)].map((path) => `1 OBJE\n2 FILE ${path}`).join('\n')}
0 TRLR`);
    return albumsInEdition(edition, [altered]).length;
  };
  assert.equal(formats('.m4a', '.flac', '.jpg'), 1);
  assert.equal(formats('.ogg', '.aiff', '.tif'), 1);
  // A family with only listening copies offers each file once.
  assert.equal(formats('.mp3', '.mp3', '.pdf'), 1);
  assert.equal(formats('.txt', '.wav', '.pdf'), 0);
  assert.equal(formats('.mp3', '.docx', '.pdf'), 0);
  assert.equal(formats('.mp3', '.wav', '.html'), 0);
});
