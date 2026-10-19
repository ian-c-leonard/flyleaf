/** Match GEDCOM relative paths only; never guess by a potentially ambiguous basename. */
export function safeRelativePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '') ||
    normalized.split('').some((char) => char.charCodeAt(0) < 32)
  )
    return null;
  return normalized;
}
export function localAssetPaths(relativePath: string): string[] {
  const safe = safeRelativePath(relativePath);
  if (!safe) return [];
  // A browser directory selection prefixes every file with its selected root.
  return [...new Set([safe, safe.slice(safe.indexOf('/') + 1)])];
}
