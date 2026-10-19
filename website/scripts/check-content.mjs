// Check the family's site content with the same rules the app applies, so a
// malformed file stops the build with a message instead of a blank page.
import { readFileSync } from 'node:fs';
import { contentFile } from '../flyleaf-settings.mjs';
import { familyRecipeBook } from '../app/lib/family-recipes.ts';

const read = (name) => JSON.parse(readFileSync(contentFile(name), 'utf8'));
try {
  familyRecipeBook(read('family-recipes.json'));
} catch (error) {
  console.error(`family-recipes.json: ${error.message}`);
  process.exit(1);
}
console.log('Site content passes its checks.');
