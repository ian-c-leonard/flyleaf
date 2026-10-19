// The licences of the software a built site ships: Flyleaf's own, then every
// package the browser code may include (the website's dependencies and
// theirs, from package-lock.json, leaving out tools used only to build and
// test it). MIT, BSD and Apache licences ask that their notices travel with
// the code, so every build publishes this file in licenses/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

export function thirdPartyNotices(site) {
  const lock = JSON.parse(
    readFileSync(path.join(site, 'package-lock.json'), 'utf8'),
  );
  const sections = [
    'Flyleaf\n\n' +
      readFileSync(path.join(site, '..', 'LICENSE'), 'utf8').trim(),
  ];
  const packages = Object.entries(lock.packages)
    .filter(([key, entry]) => key.startsWith('node_modules/') && !entry.dev)
    .map(([key, entry]) => ({
      key,
      name: key.replace(/^.*node_modules\//, ''),
      ...entry,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const pkg of packages) {
    const folder = path.join(site, pkg.key);
    // Packages for other platforms are not installed, and not shipped.
    if (!existsSync(folder)) continue;
    const file = readdirSync(folder).find((name) => LICENSE_FILE.test(name));
    const text = file
      ? readFileSync(path.join(folder, file), 'utf8').trim()
      : `Licence: ${pkg.license || 'not stated'} (the package has no licence file).`;
    sections.push(
      `${pkg.name} ${pkg.version} (${pkg.license || 'licence not stated'})\n\n${text}`,
    );
  }
  return (
    'Licences of the software in this website\n' +
    '========================================\n\n' +
    sections.join('\n\n' + '-'.repeat(72) + '\n\n') +
    '\n'
  );
}

// Source Sans 3's package carries a licence headed "Google Inc."; the font is
// Adobe's, and the notice should say so, as Google Fonts' own copy does.
export const SOURCE_SANS_COPYRIGHT =
  "Copyright 2010-2020 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. " +
  'All Rights Reserved. Source is a trademark of Adobe in the United States and/or other countries.';

export function fontLicense(packageName, text) {
  if (
    packageName === '@fontsource-variable/source-sans-3' &&
    text.startsWith('Google Inc.')
  )
    return text.replace(/^Google Inc\./, SOURCE_SANS_COPYRIGHT);
  return text;
}
