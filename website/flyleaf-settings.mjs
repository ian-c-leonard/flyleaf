// The family's settings for the site build, read from flyleaf.json.
//
// The browser app receives only the public values below, as the build-time
// constant __FLYLEAF_SITE__. Sign-in lists, account IDs and anything secret
// stay in the Worker's environment and never reach the app bundle.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The Flyleaf engine: the folder holding scripts/, book/ and website/. */
export const engineRoot = path.resolve(here, '..');

/** The family folder, found the same way as scripts/flyleaf_settings.py:
 * FLYLEAF_FAMILY, else the current folder, else the first of the engine, the
 * folder above it, or the engine's sample/ that holds a flyleaf.json. */
export function familyRoot() {
  if (process.env.FLYLEAF_FAMILY)
    return path.resolve(process.env.FLYLEAF_FAMILY);
  // The same order as scripts/flyleaf_settings.py and the flyleaf command.
  for (const candidate of [
    process.cwd(),
    path.dirname(engineRoot),
    path.join(engineRoot, 'sample'),
  ])
    if (existsSync(path.join(candidate, 'flyleaf.json'))) return candidate;
  return engineRoot;
}

/** The family's site content folder (paths.site_content, default "site"
 * as in the starter). */
export function contentRoot(settings = readSettings()) {
  return path.resolve(familyRoot(), settings.paths?.site_content || 'site');
}

/** Flyleaf's empty version of each content file, for a family without one. */
export const contentDefaults = path.join(
  engineRoot,
  'website',
  'content-defaults',
);

/** A site content file: the family's own, else Flyleaf's empty default. */
export function contentFile(name, settings = readSettings()) {
  const own = path.join(contentRoot(settings), name);
  if (existsSync(own) || !existsSync(path.join(contentDefaults, name)))
    return own;
  return path.join(contentDefaults, name);
}

export function readSettings(root = familyRoot()) {
  return JSON.parse(readFileSync(path.join(root, 'flyleaf.json'), 'utf8'));
}

/** The address the site is served from: "/" on a family's own domain, or a
 * folder such as "/demo/" (FLYLEAF_BASE_PATH, else site.base_path). The build
 * and the preview server both use it. */
export function basePath(settings = readSettings()) {
  return process.env.FLYLEAF_BASE_PATH || settings.site?.base_path || '/';
}

/** How the site is published (site.hosting). "worker": the Cloudflare Worker
 * with sign-in. "static": public files only, such as a demo on GitHub Pages.
 * A missing value means "worker": without its sign-in settings the Worker lets
 * nobody in, whereas a static site shows everything to everyone. */
/** A problem in the family's own files, which the family can fix. A script
 * run on its own prints the message alone, without a stack trace
 * (scripts/is-main.mjs). */
export class FamilyError extends Error {
  name = 'FamilyError';
}

export function siteHosting(settings = readSettings()) {
  const hosting = settings.site?.hosting || 'worker';
  if (hosting !== 'worker' && hosting !== 'static')
    throw new FamilyError(
      `flyleaf.json: site.hosting is "${hosting}". Use "worker" or "static".`,
    );
  return hosting;
}

/** Relatives may send photographs, memories and corrections only when the
 * family turns it on (features.submissions: true) and the site has sign-in. */
export function sharingOn(settings = readSettings()) {
  return (
    settings.features?.submissions === true &&
    siteHosting(settings) === 'worker'
  );
}

/** The footer says "Built with Flyleaf" unless the family sets
 * site.credit: false. */
export function creditOn(settings = readSettings()) {
  const credit = settings.site?.credit;
  if (credit !== undefined && typeof credit !== 'boolean')
    throw new FamilyError('flyleaf.json: site.credit must be true or false');
  return credit !== false;
}

/** A list of words in flyleaf.json; missing means none. */
const words = (value, name) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((w) => typeof w !== 'string' || !w))
    throw new FamilyError(
      `flyleaf.json: ${name} must be a list of words, such as ["letters"]`,
    );
  return value;
};

/** The public settings the browser app is built with. */
export function siteSettings(settings = readSettings()) {
  const need = (value, name) => {
    if (value === undefined || value === null || value === '')
      throw new FamilyError(`flyleaf.json is missing ${name}`);
    return value;
  };
  return {
    id: need(settings.site?.id, 'site.id'),
    origin: need(settings.site?.origin, 'site.origin'),
    familyName: need(settings.family?.name, 'family.name'),
    maintainer: {
      name: need(settings.maintainer?.name, 'maintainer.name'),
      firstName: need(settings.maintainer?.first_name, 'maintainer.first_name'),
      email: need(settings.maintainer?.email, 'maintainer.email'),
      // he, she or they: used as "He’ll check it" in the share form.
      pronoun: need(settings.maintainer?.pronoun, 'maintainer.pronoun'),
    },
    pdfName: need(settings.book?.pdf_name, 'book.pdf_name'),
    bookDescription:
      settings.book?.description ||
      `The history of ${need(settings.family?.name, 'family.name').replace(/^The /, 'the ')}. ` +
        'The chapters tell its stories. A reference section lists each ancestor with dates, ' +
        'family and sources.',
    // The title of the book chapter shown on its own "About the research"
    // tab (book.research_tab). Empty: no such tab.
    researchTab: settings.book?.research_tab || '',
    // The line under the family name in the site header.
    tagline: settings.site?.tagline || 'A living family history',
    // The family's own words for the album and archive on Home. Empty: the
    // site describes what the album holds, and calls the archive "documents
    // and records".
    albumIntro: settings.site?.album_intro || '',
    archiveIntro: settings.site?.archive_intro || '',
    // Words in file paths the archive shows first, such as "letters".
    archiveFirst: words(settings.site?.archive_first, 'site.archive_first'),
    hosting: siteHosting(settings),
    sharing: sharingOn(settings),
    // "Built with Flyleaf" in the footer, unless site.credit is false.
    credit: creditOn(settings),
    photos: {
      occasionWords: words(
        settings.photos?.occasion_words,
        'photos.occasion_words',
      ),
      yearbookNames: words(
        settings.photos?.yearbook_names,
        'photos.yearbook_names',
      ),
      datedWords: words(settings.photos?.dated_words, 'photos.dated_words'),
    },
    names: {
      // "Given (Maiden) Married" for married women. Off: recorded names only.
      marriedSurnames: settings.names?.married_surnames === true,
    },
  };
}

/** Vite `define` entries for the app build. */
export function siteDefines(settings) {
  return { __FLYLEAF_SITE__: JSON.stringify(siteSettings(settings)) };
}
