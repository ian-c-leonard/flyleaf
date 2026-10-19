// Write the sign-in page (public/login/index.html) from templates/login.html
// and the family's flyleaf.json. A static site has no sign-in, so the site
// build leaves the page out (installLoginPage).
//
//   node scripts/write-login-page.mjs           write the page
//   node scripts/write-login-page.mjs --check   exit 1 if it is out of date
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentFile,
  FamilyError,
  readSettings,
  siteHosting,
} from '../flyleaf-settings.mjs';
import { isMain } from './is-main.mjs';

const site = fileURLToPath(new URL('..', import.meta.url));
const template = path.join(site, 'templates/login.html');
const target = path.join(site, 'public/login/index.html');
const objectPronoun = { he: 'him', she: 'her', they: 'them' };
const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderLoginPage(settings = readSettings()) {
  const pronoun = settings.maintainer?.pronoun;
  const values = {
    familyName: settings.family?.name,
    maintainerName: settings.maintainer?.name,
    maintainerFirstName: settings.maintainer?.first_name,
    maintainerEmail: settings.maintainer?.email,
    maintainerObject: objectPronoun[pronoun] || pronoun,
  };
  return readFileSync(template, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!values[key])
      throw new FamilyError(`flyleaf.json has no value for {{${key}}}`);
    return escape(values[key]);
  });
}

/** Put the sign-in page and the monogram the emails show into the site's
 * public files when the family publishes with the Worker. A static build
 * removes both: its pages would point at a sign-in that does not exist. */
export function installLoginPage(settings = readSettings(), root = site) {
  const page = path.join(root, 'public/login/index.html');
  const monogram = path.join(root, 'public/login/monogram.png');
  if (siteHosting(settings) !== 'worker') {
    rmSync(page, { force: true });
    rmSync(monogram, { force: true });
    return false;
  }
  writeFileSync(page, renderLoginPage(settings));
  cpSync(contentFile('monogram.png', settings), monogram);
  return true;
}

if (isMain(import.meta.url)) {
  const page = renderLoginPage();
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== page) {
      console.error(
        'public/login/index.html is out of date. Run node scripts/write-login-page.mjs.',
      );
      process.exit(1);
    }
    console.log('The sign-in page matches flyleaf.json');
  } else {
    writeFileSync(target, page);
    console.log('Wrote public/login/index.html from flyleaf.json');
  }
}
