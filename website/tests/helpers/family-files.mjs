// Paths to the family's own files, for tests that check one family's data.
import path from 'node:path';
import {
  contentFile as siteFile,
  familyRoot,
} from '../../flyleaf-settings.mjs';

/** A file in the family's site content folder (paths.site_content), or
 * Flyleaf's empty default when the family has none, as the site build reads
 * it. A file with no default may not exist. */
export const contentFile = (name) => siteFile(name);
/** A file in the family folder. */
export const familyFile = (name) => path.join(familyRoot(), name);
