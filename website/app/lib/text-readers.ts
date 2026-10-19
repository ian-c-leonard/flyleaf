import { sitePath } from './paths.ts';
/** Captured HTML can retain a .txt suffix without becoming a literal-code reading. */
export function savedTextExtension(file: string, extension: string): string {
  const suffix = extension.toLowerCase();
  // A static site publishes saved pages and XML as text: page.html.txt.
  if (suffix === 'txt' && /\.x?html?\.txt$/i.test(file)) return 'html';
  if (suffix === 'txt' && /\.xml\.txt$/i.test(file)) return 'xml';
  return suffix === 'xhtml' ? 'html' : suffix;
}

/** Presentation models preserve ordering, duplicate keys and numeric spelling. */
export type JsonValue =
  | { type: 'object'; entries: { key: string; value: JsonValue }[] }
  | { type: 'array'; items: JsonValue[] }
  | { type: 'string' | 'number' | 'boolean' | 'null'; value: string };

export function readJson(content: string): JsonValue | null {
  let offset = 0;
  const space = () => {
    while (/[\t\n\r ]/.test(content[offset] || '\0')) offset++;
  };
  const take = (character: string) => {
    space();
    if (content[offset] !== character) throw new Error('Unexpected JSON token');
    offset++;
  };
  function string() {
    space();
    const match = /^"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(
      content.slice(offset),
    );
    if (!match) throw new Error('Invalid JSON string');
    offset += match[0].length;
    return JSON.parse(match[0]) as string;
  }
  function value(depth: number): JsonValue {
    if (depth > 200)
      throw new Error('Use the complete raw view for this nesting');
    space();
    if (content[offset] === '{') {
      take('{');
      space();
      const entries: { key: string; value: JsonValue }[] = [];
      if (content[offset] !== '}') {
        while (true) {
          const key = string();
          take(':');
          entries.push({ key, value: value(depth + 1) });
          space();
          if (content[offset] !== ',') break;
          take(',');
        }
      }
      take('}');
      return { type: 'object', entries };
    }
    if (content[offset] === '[') {
      take('[');
      space();
      const items: JsonValue[] = [];
      if (content[offset] !== ']') {
        while (true) {
          items.push(value(depth + 1));
          space();
          if (content[offset] !== ',') break;
          take(',');
        }
      }
      take(']');
      return { type: 'array', items };
    }
    if (content[offset] === '"') return { type: 'string', value: string() };
    const token =
      /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
        content.slice(offset),
      )?.[0];
    if (!token) throw new Error('Invalid JSON value');
    offset += token.length;
    return {
      type:
        token === 'null'
          ? 'null'
          : /^(true|false)$/.test(token)
            ? 'boolean'
            : 'number',
      value: token,
    };
  }
  try {
    const result = value(0);
    space();
    return offset === content.length ? result : null;
  } catch {
    return null;
  }
}

export function capturedIndexText(json: JsonValue | null): string | null {
  if (json?.type !== 'object') return null;
  const fields = json.entries.filter(({ key }) =>
    ['body', 'text', 'displayed_record_and_source_text'].includes(key),
  );
  if (!fields.length || fields.some(({ value }) => value.type !== 'string'))
    return null;
  const bodies = fields
    .map(({ value }) => ('value' in value ? value.value : ''))
    .filter((text) => text.trim());
  return bodies.length && bodies.every((text) => text === bodies[0])
    ? bodies[0]
    : null;
}

export type CaptureSection = {
  label: string;
  text: string;
  secondary?: boolean;
};
/** Exact, unique headings delimit saved provider text; no guessed fact table. */
export function indexSections(body: string): CaptureSection[] {
  const details = '\nDetail\nHow to evaluate details\n';
  const source = '\nSource\nInformation\n';
  const suggestions = '\nSuggested records\n';
  const markers = [details, source, suggestions];
  const starts = markers.map((marker) => body.indexOf(marker));
  if (
    starts.some(
      (start, i) => start < 0 || body.indexOf(markers[i], start + 1) !== -1,
    ) ||
    !(starts[0] < starts[1] && starts[1] < starts[2])
  )
    return [{ label: 'Page text', text: body }];
  // Every character belongs to one slice; retain controls alongside their text.
  return [
    {
      label: 'Record details',
      text: body.slice(starts[0], starts[1]),
    },
    { label: 'About this collection', text: body.slice(starts[1], starts[2]) },
    {
      label: 'Other results on the page',
      text: body.slice(starts[2]),
      secondary: true,
    },
    {
      label: 'Page heading and navigation',
      text: body.slice(0, starts[0]),
      secondary: true,
    },
  ];
}

export type ArchiveLink = { href: string; external: boolean } | null;
export function archiveTextLink(
  target: string,
  file: string,
  held: ReadonlySet<string>,
): ArchiveLink {
  const value = target.trim();
  if (!value) return null;
  for (const character of value)
    if (character.charCodeAt(0) < 32 || character === '\\') return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? { href: url.href, external: true }
        : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith('/') || value.startsWith('#')) return null;
  try {
    const url = new URL(value, 'https://archive.invalid/' + file);
    const path = decodeURIComponent(url.pathname.slice(1));
    if (url.origin !== 'https://archive.invalid' || !held.has(path))
      return null;
    return {
      href:
        sitePath('data/') +
        path.split('/').map(encodeURIComponent).join('/') +
        url.search +
        url.hash,
      external: false,
    };
  } catch {
    return null;
  }
}

export type TextNode =
  | string
  | {
      name: string;
      qualifiedName?: string;
      namespace?: string;
      attributes: [string, string][];
      children: TextNode[];
    };
const suppressedHtml = new Set(['script', 'style', 'template']);
function htmlNode(node: Node): TextNode[] {
  if (node.nodeType === 3) return [node.textContent || ''];
  if (node.nodeType !== 1) return [];
  const element = node as Element;
  const name = element.localName.toLowerCase();
  if (suppressedHtml.has(name)) return [];
  return [
    {
      name,
      attributes: [...element.attributes].map((a) => [a.name, a.value]),
      children: [...element.childNodes].flatMap(htmlNode),
    },
  ];
}

/** A detached template parses captures without requesting images or iframes. */
export function readSavedHtml(content: string) {
  const template = document.createElement('template');
  template.innerHTML = content;
  const roots = template.content;
  const mains = [...roots.querySelectorAll('main, [role="main"]')].filter(
    (node) => node.textContent?.trim(),
  );
  const articles = [...roots.querySelectorAll('article')].filter((node) =>
    node.textContent?.trim(),
  );
  // Prefer an explicit, unique article-body region to a news site's whole
  // main. These are generic semantic/CMS hints, never publisher/name matching.
  // Nested candidates collapse to the most specific region; disjoint bodies
  // remain ambiguous and retain the existing complete-main fallback.
  const bodies = [
    ...roots.querySelectorAll('[itemprop], [class], [role]'),
  ].filter((node) => {
    const explicit =
      node.getAttribute('itemprop')?.split(/\s+/).includes('articleBody') ||
      node.getAttribute('role') === 'doc-article';
    const bodyClass = [...node.classList].some((token) =>
      /articlebody$/i.test(token.replace(/[-_]/g, '')),
    );
    return (
      (explicit || bodyClass) &&
      [...node.querySelectorAll('p')].filter((paragraph) =>
        paragraph.textContent?.trim(),
      ).length >= 2
    );
  });
  const innerBodies = bodies.filter(
    (node) => !bodies.some((other) => other !== node && node.contains(other)),
  );
  const articlesWithinMain = (
    mains.length === 1 ? mains[0] : roots
  ).querySelectorAll('article');
  const independentArticles = [...articlesWithinMain].filter(
    (node) => node.textContent?.trim() && !node.querySelector('article'),
  );
  const articleBody = innerBodies.length === 1 ? innerBodies[0] : null;
  const main =
    articleBody ||
    (independentArticles.length === 1
      ? independentArticles[0]
      : mains.length === 1
        ? mains[0]
        : !mains.length && articles.length === 1
          ? articles[0]
          : null);
  const headings = [...roots.querySelectorAll('h1')].filter((node) =>
    node.textContent?.trim(),
  );
  const headline =
    main && headings.length === 1 && !main.contains(headings[0])
      ? headings[0]
      : null;
  const complete = [...roots.childNodes].flatMap(htmlNode);
  return {
    reading: main
      ? [...(headline ? htmlNode(headline) : []), ...htmlNode(main)]
      : complete,
    complete,
    hasMain: !!main,
  };
}

export function plainText(nodes: TextNode[]): string {
  const blocks = new Set([
    'p',
    'div',
    'main',
    'article',
    'section',
    'header',
    'footer',
    'nav',
    'li',
    'tr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'dt',
    'dd',
  ]);
  return nodes
    .map((node): string => {
      if (typeof node === 'string') return node;
      if (node.name === 'br') return '\n';
      if (node.name === 'img')
        return node.attributes.find(([name]) => name === 'alt')?.[1] || '';
      const body = plainText(node.children);
      return blocks.has(node.name) ? '\n' + body + '\n' : body;
    })
    .join('');
}

export function readablePageText(nodes: TextNode[]): string {
  return plainText(nodes)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function readXml(content: string): TextNode | null {
  if (/<!DOCTYPE\b/i.test(content)) return null;
  const parsed = new DOMParser().parseFromString(content, 'application/xml');
  if (parsed.querySelector('parsererror') || !parsed.documentElement)
    return null;
  function convert(node: Node): TextNode | null {
    if (node.nodeType === 3 || node.nodeType === 4)
      return node.textContent || '';
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    return {
      name: element.localName,
      qualifiedName: element.nodeName,
      namespace: element.namespaceURI || '',
      attributes: [...element.attributes].map((attribute) => [
        attribute.name,
        attribute.value,
      ]),
      children: [...element.childNodes]
        .map(convert)
        .filter((node): node is TextNode => node !== null),
    };
  }
  return convert(parsed.documentElement);
}
