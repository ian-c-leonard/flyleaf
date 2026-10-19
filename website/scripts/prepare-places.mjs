import '../flyleaf-globals.mjs';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { validateGeography, validatePlaceReadings } from '../app/lib/places.ts';
import { writeReviewedAsset } from './write-reviewed-asset.mjs';
import { contentFile, engineRoot, familyRoot } from '../flyleaf-settings.mjs';

const site = new URL('../', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('geography/basemap.json', site), 'utf8'),
);
const features = [];
for (const source of manifest.files) {
  const data = readFileSync(new URL('geography/' + source.file, site));
  if (
    data.length !== source.bytes ||
    createHash('sha256').update(data).digest('hex') !== source.sha256
  )
    throw new Error('The held basemap source changed: ' + source.file);
  const body = JSON.parse(data);
  if (body.type !== 'FeatureCollection' || !body.features.length)
    throw new Error('The basemap has no geographic features.');
  for (const feature of body.features) {
    if (
      !['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(
        feature.geometry?.type,
      )
    )
      throw new Error('Unsupported basemap geometry.');
    const properties = feature.properties;
    features.push({
      type: 'Feature',
      properties: {
        layer: source.layer,
        name:
          properties.NAME_EN ||
          properties.name_en ||
          properties.name ||
          properties.ADMIN ||
          '',
      },
      geometry: feature.geometry,
    });
  }
}
const body = JSON.stringify({ type: 'FeatureCollection', features }) + '\n';
const sha256 = createHash('sha256').update(body).digest('hex');
if (
  manifest.map?.sha256 !== sha256 ||
  manifest.map?.bytes !== Buffer.byteLength(body)
)
  throw new Error(
    `Basemap output needs review: ${sha256}, ${Buffer.byteLength(body)} bytes`,
  );
const genealogy = parseGedcom(
  readFileSync(new URL('public/data/family.ged', site), 'utf8'),
);
validateGeography(
  JSON.parse(readFileSync(contentFile('geography.json'), 'utf8')),
  genealogy,
);
validatePlaceReadings(
  JSON.parse(
    readFileSync(contentFile('place-readings.json'), 'utf8'),
  ),
  genealogy,
  JSON.parse(readFileSync(new URL('public/data/book.json', site), 'utf8'))
    .webBook,
);
const python =
  process.env.PYTHON ||
  [path.join(familyRoot(), '.venv/bin/python3'), path.join(engineRoot, '.venv/bin/python3')].find(
    existsSync,
  ) ||
  'python3';
const witnesses = spawnSync(
  python,
  [path.join(engineRoot, 'scripts/validate-website-place-readings.py')],
  { stdio: 'inherit', cwd: familyRoot(), env: { ...process.env, FLYLEAF_FAMILY: familyRoot() } },
);
if (witnesses.status !== 0)
  throw new Error('The book/place witnesses need review.');
const directory = new URL('public/geography/', site);
mkdirSync(directory, { recursive: true });
writeReviewedAsset(fileURLToPath(new URL(sha256 + '.json', directory)), body);
console.log(
  `Prepared Places geography and ${features.length} basemap features (${Buffer.byteLength(body)} bytes).`,
);
