/** A path inside the site, under the address the site is served from:
 * "/" on a family's own domain, "/demo/" for a demo in a folder
 * (site.base_path in flyleaf.json). */
export function sitePath(path: string): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return base + path.replace(/^\//, '');
}
