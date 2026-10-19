// Home page wording that names only what this family's site has. Every site
// has the book and the tree; photographs and records depend on the family.

type Has = { photos: boolean; archive: boolean };

const and = (words: string[]) =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** The line under the home page's title. */
export function homeInvitation(has: Has): string {
  const browse = and(
    [has.photos && 'photographs', has.archive && 'records'].filter(
      (w): w is string => !!w,
    ),
  );
  return browse
    ? `Read the family book, browse ${browse}, or explore a branch of the family tree.`
    : 'Read the family book, or explore a branch of the family tree.';
}

/** The footer's line under the family name. */
export function siteContents(has: Has): string {
  return and(
    [
      'Book',
      has.photos && 'photographs',
      has.archive && 'family records',
    ].filter((w): w is string => !!w),
  ).replace(/^Book$/, 'The family book and tree');
}

/** The book card's first sentence on the home page. */
export function bookCardLine(has: Has): string {
  return has.photos
    ? 'Family chapters and photographs.'
    : 'Family chapters, and each ancestor’s dates, family and sources.';
}
