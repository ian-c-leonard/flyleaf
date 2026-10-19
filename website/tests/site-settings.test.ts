import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { contentRoot, siteSettings } from '../flyleaf-settings.mjs';
import { researchChapterOf, type WebBook } from '../app/lib/native-book.ts';

// The least a family's flyleaf.json needs for the site.
const minimal = {
  site: { id: 'penhallow', origin: 'https://example.com' },
  family: { name: 'The Penhallow family' },
  maintainer: {
    name: 'Carol Penhallow',
    first_name: 'Carol',
    email: 'carol@example.com',
    pronoun: 'she',
  },
  book: { pdf_name: 'penhallow.pdf' },
};

void test('optional naming and research settings are off unless the family sets them', () => {
  const plain = siteSettings(minimal);
  assert.equal(plain.names.marriedSurnames, false);
  assert.equal(plain.researchTab, '');
  const chosen = siteSettings({
    ...minimal,
    names: { married_surnames: true },
    book: { ...minimal.book, research_tab: 'How we found them' },
  });
  assert.equal(chosen.names.marriedSurnames, true);
  assert.equal(chosen.researchTab, 'How we found them');
});

void test('the footer credits Flyleaf unless the family turns it off', () => {
  assert.equal(siteSettings(minimal).credit, true);
  const off = siteSettings({
    ...minimal,
    site: { ...minimal.site, credit: false },
  });
  assert.equal(off.credit, false);
  assert.throws(
    () => siteSettings({ ...minimal, site: { ...minimal.site, credit: 'no' } }),
    /site\.credit must be true or false/,
  );
});

void test('sharing is off unless the family turns it on for a site with sign-in', () => {
  const sharing = (features: object, site: object = {}) =>
    siteSettings({
      ...minimal,
      site: { ...minimal.site, ...site },
      features,
    }).sharing;
  assert.equal(sharing({}), false);
  assert.equal(sharing({ submissions: 'yes' }), false);
  assert.equal(sharing({ submissions: true }), true);
  assert.equal(sharing({ submissions: true }, { hosting: 'static' }), false);
  // A missing hosting value means the Worker, which lets nobody in until
  // sign-in is set up. An unknown value stops the build.
  assert.equal(siteSettings(minimal).hosting, 'worker');
  assert.throws(
    () =>
      siteSettings({ ...minimal, site: { ...minimal.site, hosting: 'pages' } }),
    /site\.hosting is "pages"/,
  );
});

void test('site content defaults to the starter’s "site" folder', () => {
  assert.equal(path.basename(contentRoot({ paths: {} })), 'site');
  assert.equal(
    path.basename(contentRoot({ paths: { site_content: 'web/words' } })),
    'words',
  );
});

void test('the research tab opens the chapter with that title, or no chapter', () => {
  const section = (chapter: string, title: string, level = 2) => ({
    anchor: chapter,
    chapter,
    level,
    title,
    excerpt: '',
    image: '',
    people: [],
  });
  const web = {
    sections: [
      section('reading-introduction', 'Introduction'),
      section('reading-how-we-found-them', 'How we  found them'),
      section('reading-sources', 'How we found them', 3),
    ],
  } as unknown as WebBook;
  assert.equal(
    researchChapterOf(web, 'How we found them'),
    'reading-how-we-found-them',
  );
  assert.equal(researchChapterOf(web, 'Methodology'), '');
  assert.equal(researchChapterOf(web, ''), '');
  assert.equal(researchChapterOf(null, 'How we found them'), '');
});

void test('settings find the engine from a folder whose name has spaces', async () => {
  const folder = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'flyleaf with spaces ')),
  );
  try {
    cpSync(
      new URL('../flyleaf-settings.mjs', import.meta.url),
      path.join(folder, 'website', 'flyleaf-settings.mjs'),
    );
    const copy = (await import(
      pathToFileURL(path.join(folder, 'website', 'flyleaf-settings.mjs')).href
    )) as { engineRoot: string; contentDefaults: string };
    assert.equal(copy.engineRoot, folder);
    assert.equal(
      copy.contentDefaults,
      path.join(folder, 'website', 'content-defaults'),
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
