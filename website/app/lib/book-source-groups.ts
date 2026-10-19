export type SourceSiblingKind = 'note' | 'comma' | 'space' | 'other';

/** The compiler's unstyled SUP comma is structural; ordinary commas are prose. */
export function sourceGroupRanges(
  kinds: SourceSiblingKind[],
): [number, number][] {
  const groups: [number, number][] = [];
  let index = 0;
  while (index < kinds.length) {
    if (kinds[index] !== 'note') {
      index++;
      continue;
    }
    let end = index;
    while (true) {
      let cursor = end + 1;
      let commas = 0;
      while (
        cursor < kinds.length &&
        (kinds[cursor] === 'space' || kinds[cursor] === 'comma')
      ) {
        if (kinds[cursor] === 'comma') commas++;
        cursor++;
      }
      if (commas !== 1 || kinds[cursor] !== 'note') break;
      end = cursor;
    }
    if (end > index) groups.push([index, end]);
    index = end + 1;
  }
  return groups;
}

function siblingKind(node: Node): SourceSiblingKind {
  if (node.nodeType === 3) return node.textContent?.trim() ? 'other' : 'space';
  if (!(node instanceof Element)) return 'other';
  if (node.getAttribute('role') === 'doc-noteref' && node.tagName === 'A')
    return 'note';
  if (
    node.attributes.length === 0 &&
    node.tagName === 'SUP' &&
    node.childNodes.length === 1 &&
    node.firstChild?.nodeType === 3 &&
    node.textContent === ','
  )
    return 'comma';
  if (
    node.attributes.length === 0 &&
    node.tagName === 'SPAN' &&
    !node.textContent?.trim() &&
    [...node.childNodes].every((child) => child.nodeType === 3)
  )
    return 'space';
  return 'other';
}

/** Move existing nodes into a display-only wrapper, with an exact cleanup. */
export function groupAdjacentBookNotes(content: HTMLElement): () => void {
  const parents = new Set(
    [...content.querySelectorAll('a[role="doc-noteref"]')]
      .map((note) => note.parentElement)
      .filter(
        (parent): parent is HTMLElement =>
          !!parent && !parent.classList.contains('book-source-group'),
      ),
  );
  const wrappers: HTMLElement[] = [];
  for (const parent of parents) {
    const nodes = [...parent.childNodes];
    for (const [start, end] of sourceGroupRanges(nodes.map(siblingKind))) {
      const wrapper = content.ownerDocument.createElement('span');
      wrapper.className = 'book-source-group';
      parent.insertBefore(wrapper, nodes[start]);
      for (const node of nodes.slice(start, end + 1)) wrapper.appendChild(node);
      wrappers.push(wrapper);
    }
  }
  return () => {
    for (const wrapper of wrappers) wrapper.replaceWith(...wrapper.childNodes);
  };
}
