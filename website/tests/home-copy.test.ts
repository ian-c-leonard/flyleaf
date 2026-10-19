import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookCardLine,
  homeInvitation,
  siteContents,
} from '../app/lib/home-copy.ts';

void test('the home page names only what the site has', () => {
  const all = { photos: true, archive: true };
  const none = { photos: false, archive: false };
  assert.equal(
    homeInvitation(all),
    'Read the family book, browse photographs and records, or explore a branch of the family tree.',
  );
  assert.equal(
    homeInvitation({ photos: false, archive: true }),
    'Read the family book, browse records, or explore a branch of the family tree.',
  );
  assert.equal(
    homeInvitation(none),
    'Read the family book, or explore a branch of the family tree.',
  );
  assert.equal(siteContents(all), 'Book, photographs and family records');
  assert.equal(
    siteContents({ photos: true, archive: false }),
    'Book and photographs',
  );
  assert.equal(siteContents(none), 'The family book and tree');
  assert.equal(bookCardLine(all), 'Family chapters and photographs.');
  assert.doesNotMatch(bookCardLine(none), /photograph/);
});
