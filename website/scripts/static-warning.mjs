// The warning every static build prints: once when it prepares the data, and
// again on its own at the very end, where a long build log cannot hide it.
export const staticWarning =
  'This is a static site: anyone with its address can read all of it, and ' +
  'every document in it. See docs/hosting.md for a private site with sign-in.';

/** Print the warning between blank lines, so it stands apart from the log. */
export function printStaticWarning(log = console.warn) {
  log(`\n${staticWarning}\n`);
}
