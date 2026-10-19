import {
  createElement,
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { marked, type Token, type Tokens } from 'marked';
import {
  archiveTextLink,
  capturedIndexText,
  indexSections,
  readablePageText,
  readJson,
  readSavedHtml,
  readXml,
  savedTextExtension,
  type JsonValue,
  type TextNode,
} from '../lib/text-readers';
import '../text-reader.css';
import { sitePath } from '../lib/paths';

const keyLabel = (key: string) =>
  key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function JsonReading({
  value,
  depth = 0,
}: {
  value: JsonValue;
  depth?: number;
}) {
  if (value.type === 'object')
    return value.entries.length ? (
      <dl className="json-fields" data-nested={depth > 0 && depth < 3}>
        {value.entries.map((entry, index) => (
          <div key={index}>
            <dt>
              {keyLabel(entry.key)} <code>{entry.key}</code>
            </dt>
            <dd>
              <JsonReading value={entry.value} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <p className="reader-empty">Empty object</p>
    );
  if (value.type === 'array')
    return value.items.length ? (
      <ol className="json-items">
        {value.items.map((item, index) => (
          <li key={index}>
            <JsonReading value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    ) : (
      <p className="reader-empty">Empty list</p>
    );
  return (
    <p className="json-value" data-value-type={value.type}>
      {value.type === 'string' && !value.value ? (
        <span className="reader-empty">Empty text</span>
      ) : (
        value.value
      )}
    </p>
  );
}

function TextLink({
  target,
  file,
  held,
  children,
}: {
  target: string;
  file: string;
  held: ReadonlySet<string>;
  children: ReactNode;
}) {
  const link = archiveTextLink(target, file, held);
  return link ? (
    <a href={link.href} target="_blank" rel="noreferrer" title={target}>
      {children}
      {link.external && <span className="reader-link-kind"> ↗</span>}
    </a>
  ) : (
    <span className="reader-unavailable-link" title={target}>
      {children} <small>(unavailable here)</small>
    </span>
  );
}

function decodeEntities(text: string) {
  return text.replace(
    /&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g,
    (entity) => {
      const decoder = document.createElement('textarea');
      decoder.innerHTML = entity;
      return decoder.value;
    },
  );
}

function MarkdownReading({
  content,
  file,
  held,
}: {
  content: string;
  file: string;
  held: ReadonlySet<string>;
}) {
  const tokens = useMemo(() => marked.lexer(content), [content]);
  function render(tokens: Token[]): ReactNode {
    return tokens.map((token, index) => {
      let node: ReactNode;
      switch (token.type) {
        case 'space':
        case 'def':
          return null;
        case 'heading': {
          const t = token as Tokens.Heading;
          node = createElement(
            'h' + Math.min(6, t.depth + 1),
            {},
            render(t.tokens),
          );
          break;
        }
        case 'paragraph':
          node = <p>{render((token as Tokens.Paragraph).tokens)}</p>;
          break;
        case 'text': {
          const t = token as Tokens.Text;
          node = t.tokens ? render(t.tokens) : decodeEntities(t.text);
          break;
        }
        case 'escape':
          node = (token as Tokens.Escape).text;
          break;
        case 'strong':
          node = <strong>{render((token as Tokens.Strong).tokens)}</strong>;
          break;
        case 'em':
          node = <em>{render((token as Tokens.Em).tokens)}</em>;
          break;
        case 'del':
          node = <del>{render((token as Tokens.Del).tokens)}</del>;
          break;
        case 'br':
          node = <br />;
          break;
        case 'hr':
          node = <hr />;
          break;
        case 'code':
          node = (
            <pre>
              <code>{(token as Tokens.Code).text}</code>
            </pre>
          );
          break;
        case 'codespan':
          node = <code>{(token as Tokens.Codespan).text}</code>;
          break;
        case 'blockquote':
          node = (
            <blockquote>
              {render((token as Tokens.Blockquote).tokens)}
            </blockquote>
          );
          break;
        case 'html':
          node = <code className="reader-literal-html">{token.raw}</code>;
          break;
        case 'link':
        case 'image': {
          const t = token as Tokens.Link | Tokens.Image;
          const target = decodeEntities(t.href);
          const image =
            t.type === 'image' ? archiveTextLink(target, file, held) : null;
          node =
            image &&
            !image.external &&
            /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(image.href) ? (
              <img
                className="reader-held-image"
                src={image.href}
                alt={t.text}
              />
            ) : (
              <TextLink target={target} file={file} held={held}>
                {t.type === 'image'
                  ? `Image: ${t.text || t.href}`
                  : render(t.tokens)}
              </TextLink>
            );
          break;
        }
        case 'list': {
          const t = token as Tokens.List;
          node = createElement(
            t.ordered ? 'ol' : 'ul',
            t.ordered
              ? { start: typeof t.start === 'number' ? t.start : 1 }
              : {},
            t.items.map((item, i) => (
              <li key={i}>
                {item.task && (
                  <span
                    aria-label={item.checked ? 'Completed' : 'Not completed'}
                  >
                    {item.checked ? '☑ ' : '☐ '}
                  </span>
                )}
                {render(item.tokens)}
              </li>
            )),
          );
          break;
        }
        case 'table': {
          const t = token as Tokens.Table;
          node = (
            <div className="reader-table">
              <table>
                <thead>
                  <tr>
                    {t.header.map((cell, i) => (
                      <th key={i}>{render(cell.tokens)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{render(cell.tokens)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          break;
        }
        default:
          node = <span>{token.raw}</span>;
      }
      return <Fragment key={index}>{node}</Fragment>;
    });
  }
  return <>{render(tokens)}</>;
}

function HtmlReading({
  nodes,
  file,
  held,
}: {
  nodes: TextNode[];
  file: string;
  held: ReadonlySet<string>;
}) {
  const blocks = new Set([
    'p',
    'div',
    'main',
    'article',
    'section',
    'header',
    'footer',
    'nav',
    'aside',
    'figure',
    'figcaption',
  ]);
  const tags = new Set([
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'sup',
    'sub',
    'blockquote',
    'pre',
    'code',
    'br',
    'hr',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'table',
    'caption',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
  ]);
  function render(nodes: TextNode[]): ReactNode {
    return nodes.map((node, i) => {
      if (typeof node === 'string') return node;
      const attribute = (name: string) =>
        node.attributes.find(([key]) => key === name)?.[1] || '';
      const children = render(node.children);
      let element: ReactNode;
      if (node.name === 'a')
        element = attribute('href') ? (
          <TextLink target={attribute('href')} file={file} held={held}>
            {children}
          </TextLink>
        ) : (
          children
        );
      else if (node.name === 'img')
        element = attribute('alt') ? (
          <span className="reader-image-label">
            [Image in saved page: {attribute('alt')}]
          </span>
        ) : null;
      else if (/^h[1-6]$/.test(node.name))
        element = createElement(
          'h' + Math.min(6, Number(node.name[1]) + 1),
          {},
          children,
        );
      else if (blocks.has(node.name) || tags.has(node.name))
        element = createElement(
          blocks.has(node.name) && node.name !== 'p' ? 'div' : node.name,
          {},
          ['br', 'hr'].includes(node.name) ? undefined : children,
        );
      else element = <span>{children}</span>;
      return <Fragment key={i}>{element}</Fragment>;
    });
  }
  return <>{render(nodes)}</>;
}

const xmlLabels: Record<string, string> = {
  ead: 'Collection guide',
  eadheader: 'Publication details',
  filedesc: 'About this guide',
  titlestmt: 'Title and author',
  publicationstmt: 'Publication',
  seriesstmt: 'Series statement',
  profiledesc: 'Preparation details',
  archdesc: 'Collection description',
  did: 'Description',
  unitid: 'Collection identifier',
  repository: 'Repository',
  langmaterial: 'Language',
  physdesc: 'Physical description',
  unitdate: 'Date',
  origination: 'Creator',
  titleproper: 'Guide title',
  author: 'Prepared by',
  publisher: 'Publisher',
  address: 'Address',
  date: 'Date',
  creation: 'Preparation',
  langusage: 'Language',
  descrules: 'Description standard',
  eadid: 'Guide identifier',
  extent: 'Extent',
  language: 'Language',
  container: 'Container',
  num: 'Identifier',
  controlaccess: 'Index terms',
  subject: 'Subject',
  dsc: 'Collection inventory',
};

function XmlReading({
  node,
  inline = false,
}: {
  node: TextNode;
  inline?: boolean;
}): ReactNode {
  if (typeof node === 'string') return node;
  const qualifiedName = node.qualifiedName || node.name;
  const knownName =
    !!xmlLabels[node.name] ||
    /^(?:p|head|unittitle|emph|c\d\d|c|ref|extref|corpname|persname|addressline)$/.test(
      node.name,
    );
  const known =
    knownName &&
    (!node.namespace || node.namespace === 'urn:isbn:1-931666-22-9');
  const identity: [string, string][] =
    !known || qualifiedName !== node.name
      ? [
          ['Element', qualifiedName],
          ...(node.namespace
            ? [['Namespace', node.namespace] as [string, string]]
            : []),
        ]
      : [];
  const metadata = [...identity, ...node.attributes];
  const children = node.children.map((child, i) => (
    <XmlReading
      key={i}
      node={child}
      inline={
        inline ||
        (known &&
          ['p', 'head', 'unittitle', 'titleproper', 'emph'].includes(node.name))
      }
    />
  ));
  const identityAttributes = {
    'data-xml-element': node.name,
    'data-xml-name': qualifiedName,
    'data-xml-namespace': node.namespace || '',
  };
  const attributes = metadata.length > 0 && (
    <details className="xml-attributes">
      <summary>Details</summary>
      <dl>
        {metadata.map(([key, value], i) => (
          <div key={i}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
  const inlineMetadata = metadata.length > 0 && (
    <span className="xml-inline-attributes">
      {' '}
      ({metadata.map(([key, value]) => `${key}: ${value}`).join('; ')})
    </span>
  );
  if (known && node.name === 'emph')
    return (
      <span {...identityAttributes}>
        <em>{children}</em>
        {inlineMetadata}
      </span>
    );
  if (
    inline &&
    (!known || !['p', 'head', 'unittitle', 'titleproper'].includes(node.name))
  )
    return (
      <span {...identityAttributes}>
        {!known && (
          <span className="xml-inline-element">[{qualifiedName}] </span>
        )}
        {children}
        {inlineMetadata}
      </span>
    );
  if (known && node.name === 'p')
    return (
      <div className="xml-paragraph" {...identityAttributes}>
        <p>{children}</p>
        {attributes}
      </div>
    );
  if (known && ['head', 'unittitle', 'titleproper'].includes(node.name))
    return (
      <div className="xml-heading" {...identityAttributes}>
        <h3>{children}</h3>
        {attributes}
      </div>
    );
  const component = known && (/^c\d\d$/.test(node.name) || node.name === 'c');
  const structural =
    component || (known && ['ead', 'archdesc', 'did'].includes(node.name));
  const hasHeading =
    known &&
    node.children.some(
      (child) =>
        typeof child !== 'string' &&
        child.name === 'head' &&
        child.namespace === node.namespace,
    );
  const label =
    node.attributes.find(([key]) => key === 'label')?.[1] ||
    (known ? xmlLabels[node.name] : qualifiedName) ||
    qualifiedName;
  return (
    <section
      className={
        component ? 'xml-entry' : structural ? 'xml-group' : 'xml-field'
      }
      {...identityAttributes}
    >
      {!structural && !hasHeading && <h4>{label}</h4>}
      {children}
      {attributes}
    </section>
  );
}

export default function TextDocument({
  content,
  extension,
  kind,
  file,
}: {
  content: string;
  extension: string;
  kind: string;
  file: string;
}) {
  const [view, setView] = useState('reading');
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const format = savedTextExtension(file, extension);
  const json = useMemo(
    () => (format === 'json' ? readJson(content) : null),
    [content, format],
  );
  const html = useMemo(
    () => (['html', 'htm'].includes(format) ? readSavedHtml(content) : null),
    [content, format],
  );
  const xml = useMemo(
    () => (format === 'xml' ? readXml(content) : null),
    [content, format],
  );
  const body = kind === 'record-index' ? capturedIndexText(json) : null;
  useEffect(() => {
    if (!['md', 'html', 'htm'].includes(format)) return;
    const controller = new AbortController();
    fetch(sitePath('data/manifest.json'), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('assets' in value) ||
          !Array.isArray(value.assets)
        )
          return;
        const missing =
          'missingAssets' in value && Array.isArray(value.missingAssets)
            ? value.missingAssets
            : [];
        const paths = value.assets.filter(
          (path): path is string =>
            typeof path === 'string' && !missing.includes(path),
        );
        if (!controller.signal.aborted) setHeld(new Set(paths));
      })
      .catch(() => {
        /* Unverified relative links stay readable, without a route. */
      });
    return () => controller.abort();
  }, [format]);
  const views = [['reading', 'Reading view']];
  if (body) views.push(['complete', 'Full page']);
  if (html?.hasMain) views.push(['complete', 'Full page']);
  if (['json', 'xml', 'html', 'htm', 'md'].includes(format))
    views.push(['raw', 'Original text']);
  const ead =
    xml &&
    typeof xml !== 'string' &&
    xml.name === 'ead' &&
    (!xml.namespace || xml.namespace === 'urn:isbn:1-931666-22-9')
      ? xml
      : null;
  return (
    <div className="text-document">
      {views.length > 1 && (
        <div className="text-view-controls" aria-label="Text presentation">
          {views.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {kind === 'record-index' && (
        <p className="document-provenance">
          This is a saved search result. Other results on the page may be about
          different people.
        </p>
      )}
      <article className="document-reading" data-text-view={view}>
        {view === 'raw' ? (
          <pre className="document-raw">{content}</pre>
        ) : html ? (
          view === 'complete' ? (
            <div className="saved-page-text">
              {readablePageText(html.complete)}
            </div>
          ) : (
            <HtmlReading nodes={html.reading} file={file} held={held} />
          )
        ) : json ? (
          body && view === 'reading' ? (
            indexSections(body).map((section, i) =>
              section.secondary ? (
                <details className="capture-secondary" key={i}>
                  <summary>{section.label}</summary>
                  <div className="capture-text">{section.text}</div>
                </details>
              ) : (
                <section key={i}>
                  <h3>{section.label}</h3>
                  <div className="capture-text">{section.text}</div>
                </section>
              ),
            )
          ) : (
            <JsonReading value={json} />
          )
        ) : xml ? (
          ead ? (
            <>
              {ead.children
                .filter(
                  (node) =>
                    typeof node !== 'string' && node.name === 'archdesc',
                )
                .map((node, i) => (
                  <XmlReading key={i} node={node} />
                ))}
              <details className="capture-secondary">
                <summary>About this guide</summary>
                <XmlReading
                  node={{
                    ...ead,
                    children: ead.children.filter(
                      (node) =>
                        typeof node === 'string' || node.name !== 'archdesc',
                    ),
                  }}
                />
              </details>
            </>
          ) : (
            <XmlReading node={xml} />
          )
        ) : format === 'md' ? (
          <MarkdownReading content={content} file={file} held={held} />
        ) : (
          <>
            {['json', 'xml'].includes(format) && (
              <p className="document-provenance">
                This file is shown as plain text.
              </p>
            )}
            <pre className="document-raw">
              {content || 'This text file is empty.'}
            </pre>
          </>
        )}
      </article>
    </div>
  );
}
