import type { Representation } from './gedcom.ts';

/** File relationships carry source context, never claims that a person is pictured. */
export function connectedFiles(
  relations: Representation[],
  initial: Iterable<string>,
) {
  const adjacent = new Map<string, Set<string>>();
  for (const { parent, child } of relations) {
    for (const [a, b] of [
      [parent, child],
      [child, parent],
    ]) {
      const links = adjacent.get(a) || new Set<string>();
      links.add(b);
      adjacent.set(a, links);
    }
  }
  const result = new Set(initial),
    pending = [...result];
  while (pending.length) {
    const path = pending.pop()!;
    for (const next of adjacent.get(path) || []) {
      if (result.has(next)) continue;
      result.add(next);
      pending.push(next);
    }
  }
  return result;
}
