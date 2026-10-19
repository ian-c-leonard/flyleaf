import displayCopy from '@content/display-copy.json' with { type: 'json' };

/** Exact display wording for reviewed mention qualifications, from the
 * family's content/display-copy.json. Manuscript passages, source notes and
 * unmatched qualifications stay unchanged.
 */
export const bookPreviewCopy: ReadonlyMap<string, string> = new Map(
  displayCopy.replacements.map(
    ([original, reader]) => [original, reader] as [string, string],
  ),
);
