import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { engineRoot, familyRoot, readSettings } from '../flyleaf-settings.mjs';
import { plainFamilyErrors } from './is-main.mjs';
import { printStaticWarning } from './static-warning.mjs';
import { fontLicense, thirdPartyNotices } from './third-party-notices.mjs';
import { installLoginPage } from './write-login-page.mjs';
import { render as renderWrangler } from './write-wrangler.mjs';
// The engine's Python scripts run in the family folder, on its content; the
// site's working files and data stay in this site folder.
plainFamilyErrors();
const site = fileURLToPath(new URL('..', import.meta.url));
const family = familyRoot();
const script = (name) => path.join(engineRoot, 'scripts', name);
const python =
  process.env.PYTHON ||
  [
    path.join(family, '.venv/bin/python3'),
    path.join(engineRoot, '.venv/bin/python3'),
  ].find(existsSync) ||
  'python3';
const run = {
  cwd: family,
  stdio: 'inherit',
  env: { ...process.env, FLYLEAF_FAMILY: family },
};
// The site carries the book, so the book comes first. The book folder is
// paths.book in flyleaf.json.
const claimsMap = path.posix.join(
  readSettings().paths?.book || 'book',
  'CLAIMS-MAP.json',
);
if (
  !['build/book-publication.json', claimsMap].every((f) =>
    existsSync(path.join(family, f)),
  )
) {
  console.error(
    'Build the book first: flyleaf book (it makes the files the website needs).',
  );
  process.exit(1);
}
const sourceText = spawnSync(python, [script('render-source-text.py')], run);
if (sourceText.status !== 0) process.exit(sourceText.status || 1);
const composition = spawnSync(
  python,
  [
    script('compose-website.py'),
    '--book-map',
    claimsMap,
    // Archive derivations (data/representations.json) are optional.
    ...(existsSync(path.join(family, 'data/representations.json'))
      ? ['--representations', 'data/representations.json']
      : []),
  ],
  run,
);
if (composition.status !== 0) process.exit(composition.status || 1);
const result = spawnSync(
  python,
  [
    script('export-website.py'),
    '--source',
    path.join(site, 'work/current.ged'),
    '--previews',
    '--book-receipt',
    'build/book-publication.json',
    '--native-book',
    '--composition-receipt',
    path.join(site, 'work/current.composition.json'),
  ],
  run,
);
if (result.status !== 0) process.exit(result.status || 1);
const places = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    './flyleaf-globals.mjs',
    'scripts/prepare-places.mjs',
  ],
  {
    cwd: site,
    stdio: 'inherit',
    env: { ...process.env, FLYLEAF_FAMILY: family },
  },
);
if (places.status !== 0) process.exit(places.status || 1);
const content = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    './flyleaf-globals.mjs',
    'scripts/check-content.mjs',
  ],
  {
    cwd: site,
    stdio: 'inherit',
    env: { ...process.env, FLYLEAF_FAMILY: family },
  },
);
if (content.status !== 0) process.exit(content.status || 1);

// Files made from this family's settings when it uses the Worker: the
// sign-in page, the monogram its emails show, and the Worker's configuration.
const settings = readSettings();
if (installLoginPage(settings, site))
  writeFileSync(path.join(site, 'wrangler.jsonc'), renderWrangler(settings));
else printStaticWarning();

// The site's two typefaces, EB Garamond and Source Sans 3, use the SIL Open
// Font License, which travels with the fonts. Every build publishes the
// licences in licenses/. Sign-in must also use these faces before a session
// exists, so the Worker's sign-in folder carries its own copies of the Latin
// faces and their licences; the gateway allows their exact paths.
const licenses = path.join(site, 'public/licenses');
const loginFonts = path.join(site, 'public/login/fonts');
mkdirSync(licenses, { recursive: true });
mkdirSync(loginFonts, { recursive: true });
for (const [packageName, fontFile, licenseFile] of [
  [
    '@fontsource/eb-garamond',
    'eb-garamond-latin-400-normal.woff2',
    'eb-garamond-OFL.txt',
  ],
  [
    '@fontsource-variable/source-sans-3',
    'source-sans-3-latin-wght-normal.woff2',
    'source-sans-3-OFL.txt',
  ],
]) {
  const fontPackage = path.join(site, 'node_modules', packageName);
  cpSync(
    path.join(fontPackage, 'files', fontFile),
    path.join(loginFonts, fontFile),
  );
  const license = fontLicense(
    packageName,
    readFileSync(path.join(fontPackage, 'LICENSE'), 'utf8'),
  );
  writeFileSync(path.join(loginFonts, licenseFile), license);
  writeFileSync(path.join(licenses, licenseFile), license);
}
// The licences of the software the site's code includes.
writeFileSync(path.join(licenses, 'third-party.txt'), thirdPartyNotices(site));

const pdfjs = path.join(site, 'node_modules/pdfjs-dist');
const destination = path.join(site, 'public/pdfjs');
mkdirSync(destination, { recursive: true });
for (const name of ['wasm', 'standard_fonts', 'LICENSE'])
  cpSync(path.join(pdfjs, name), path.join(destination, name), {
    recursive: true,
  });

// Pair the compatibility API with its matching static worker. Dev middleware
// must not inject window-only overlays into a worker module.
cpSync(
  path.join(pdfjs, 'legacy/build/pdf.worker.min.mjs'),
  path.join(destination, 'pdf.legacy.worker.min.mjs'),
);
