/* These composite canvas controls implement keyboard pan/orbit/zoom and offer equivalent text navigation. */
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  CornersOutIcon,
  CrosshairSimpleIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  TreeStructureIcon,
} from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';
import {
  familyGroups,
  familyLayout,
  TREE_CARD_HEIGHT,
  TREE_CARD_WIDTH,
} from '../lib/tree';
import type { Direction } from '../lib/tree';
import type { Asset, AtlasData, Person } from '../lib/gedcom';
import { lifespan } from '../lib/gedcom';
import { formatGedcomDate } from '../lib/date-display';
import { identifiedPortrait, visualFor } from '../lib/visuals';
import { createPeopleSearch, relationshipFinder } from '../lib/family-browsing';
import { useDismissible } from '../lib/useDismissible';
import BrowsingImage from './BrowsingImage';

type Transform = { x: number; y: number; scale: number };
/** Readable labels for GEDCOM pedigree values. Birth, unknown and church
 * sealing values are not shown. */
const parentageLabels: Record<string, string> = {
  adopted: 'Adopted',
  foster: 'Foster child',
  step: 'Stepchild',
};

export default function FamilyTree({
  data,
  initialFocus,
  onPerson,
  onBack,
  onFocus,
  assetUrl,
  previewUrl = () => '',
}: {
  data: AtlasData;
  initialFocus: string;
  onPerson: (id: string) => void;
  onBack: () => void;
  onFocus: (id: string) => void;
  assetUrl: (asset: Asset) => string;
  /** The small preview of a picture, or '' when there is none. */
  previewUrl?: (asset: Asset) => string;
}) {
  const focus = data.people.some((p) => p.id === initialFocus)
    ? initialFocus
    : data.rootId;
  const [direction, setDirection] = useState<Direction>('family');
  const [depth, setDepth] = useState(1);
  const [search, setSearch] = useState('');
  const [transform, setTransform] = useState<Transform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [dragging, setDragging] = useState(false);
  // Desktop opens on the diagram; narrow phones start with the readable list.
  const [list, setList] = useState(
    () => !window.matchMedia('(min-width: 700px)').matches,
  );
  const searchRoot = useRef<HTMLDivElement>(null);
  const searchResults = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const cousinHeading = useRef<HTMLHeadingElement>(null);
  useDismissible({
    enabled: !!search.trim(),
    modal: false,
    root: () => searchRoot.current,
    inside: () => [searchRoot.current, searchResults.current],
    trigger: () => searchInput.current,
    onDismiss: () => setSearch(''),
  });
  const viewport = useRef<HTMLDivElement>(null);
  const current = useRef(transform);
  const updateTransform = useCallback((next: Transform) => {
    // Pointer events can arrive together before React commits a render.
    current.current = next;
    setTransform(next);
  }, []);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  );
  const pinch = useRef<{
    distance: number;
    x: number;
    y: number;
    transform: Transform;
  } | null>(null);

  function beginGesture() {
    drag.current = null;
    pinch.current = null;
    const [a, b] = [...pointers.current.values()];
    if (a && b && viewport.current) {
      const bounds = viewport.current.getBoundingClientRect();
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        x: (a.x + b.x) / 2 - bounds.left,
        y: (a.y + b.y) / 2 - bounds.top,
        transform: current.current,
      };
    } else if (a) {
      drag.current = {
        ...a,
        tx: current.current.x,
        ty: current.current.y,
      };
    }
    setDragging(!!a);
  }

  function endPointer(id: number) {
    if (pointers.current.delete(id)) beginGesture();
  }
  // A fast touch release can reach the page instead of the tree, which then
  // never sees it and stays mid-drag. End a tracked pointer wherever it ends.
  useEffect(() => {
    const end = (event: PointerEvent) => endPointer(event.pointerId);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  });
  const reduce = useReducedMotion();
  const layout = useMemo(
    () => familyLayout(data, focus, direction, depth),
    [data, focus, direction, depth],
  );
  const byId = useMemo(
    () => new Map(data.people.map((p) => [p.id, p])),
    [data],
  );
  const positions = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout],
  );
  // Children of a visible couple share one line from the couple.
  const coupleLinks = layout.nodes.flatMap((node) => {
    const parents = layout.links.filter(
      (link) => link.kind === 'parent' && link.to === node.id,
    );
    if (parents.length !== 2) return [];
    const [a, b] = parents.map((link) => link.from);
    const pa = positions.get(a),
      pb = positions.get(b);
    if (!pa || !pb || pa.x !== pb.x || !byId.get(a)?.partners.includes(b))
      return [];
    return [{ a, b, child: node.id, parentage: parents[0].parentage }];
  });
  const coupleChildren = new Set(coupleLinks.map((link) => link.child));
  const person = byId.get(focus) || byId.get(data.rootId)!;
  const relationship = useMemo(
    () => relationshipFinder(data, focus),
    [data, focus],
  );
  const relationships = useMemo(
    () =>
      new Map(
        data.people.map((relative) => [relative.id, relationship(relative.id)]),
      ),
    [data, relationship],
  );
  const searchPeople = useMemo(
    () => createPeopleSearch(data, focus, relationship),
    [data, focus, relationship],
  );
  const groups = useMemo(
    () =>
      familyGroups(
        data,
        layout.nodes.map((node) => node.id),
        focus,
      ),
    [data, layout, focus],
  );
  const groupedIds = new Set(
    groups.flatMap((group) =>
      [...group.parents, ...group.children].map((relative) => relative.id),
    ),
  );
  const cousins = layout.nodes
    .map((node) => byId.get(node.id)!)
    .filter((relative) => relationships.get(relative.id)?.kind === 'cousin');
  const relationshipLabel = (relative: Person) =>
    relative.id === focus
      ? 'Selected person'
      : relationships.get(relative.id)?.label || 'Relative';
  function portrait(relative: Person) {
    const asset = identifiedPortrait(data, relative.id);
    return (
      <span className="tree-monogram">
        {asset && assetUrl(asset) ? (
          <BrowsingImage
            original={assetUrl(asset)}
            src={previewUrl(asset) || assetUrl(asset)}
            alt=""
            style={{
              objectPosition:
                visualFor(data, asset.path)?.avatarPosition || 'top',
            }}
          />
        ) : (
          <>
            {relative.given[0]}
            {relative.surname[0]}
          </>
        )}
      </span>
    );
  }
  function relativeRow(relative: Person, family?: string) {
    const dates = lifespan(relative);
    const parentage = family
      ? relative.parentLinks.find((link) => link.family === family)?.kind
      : '';
    return (
      <li key={relative.id}>
        <button
          className="tree-relative-details"
          onClick={() => onPerson(relative.id)}
        >
          {portrait(relative)}
          <span>
            <strong>{relative.name}</strong>
            <small>{relationshipLabel(relative)}</small>
            {dates && <span className="tree-relative-dates">{dates}</span>}
            {parentage && parentageLabels[parentage] && (
              <span className="tree-parentage">
                {parentageLabels[parentage]}
              </span>
            )}
          </span>
        </button>
        <button
          className="tree-relative-focus"
          onClick={() => changeFocus(relative.id)}
          aria-label={`Explore ${relative.name}’s family`}
          title={`Explore ${relative.given.split(' ')[0]}’s family`}
        >
          <CrosshairSimpleIcon size={19} />
        </button>
      </li>
    );
  }
  const fit = useCallback(
    (all = false) => {
      if (!viewport.current) return;
      const width = viewport.current.clientWidth,
        height = viewport.current.clientHeight;
      const pad = 30;
      const whole = Math.min(
        1.05,
        (width - 2 * pad) / layout.width,
        (height - 2 * pad) / layout.height,
      );
      // Show the whole tree when it stays readable; otherwise centre on the
      // selected person without leaving empty space beside the tree.
      const scale = all
        ? Math.max(0.01, whole)
        : whole >= 0.6
          ? Math.min(1, whole)
          : width < 600
            ? 0.85
            : 1;
      const place = (view: number, size: number, centre: number) => {
        const content = size * scale;
        if (all || content <= view - 2 * pad) return (view - content) / 2;
        const offset = view / 2 - centre * scale;
        return Math.min(pad, Math.max(view - content - pad, offset));
      };
      const center = positions.get(focus);
      updateTransform({
        scale,
        x: place(width, layout.width, (center?.x || 0) + TREE_CARD_WIDTH / 2),
        y: place(
          height,
          layout.height,
          (center?.y || 0) + TREE_CARD_HEIGHT / 2,
        ),
      });
    },
    [layout, focus, positions, updateTransform],
  );
  const zoom = useCallback(
    (factor: number, x?: number, y?: number) => {
      const t = current.current;
      const scale = Math.max(0.01, Math.min(2.5, t.scale * factor));
      const cx = x ?? (viewport.current?.clientWidth || 800) / 2;
      const cy = y ?? (viewport.current?.clientHeight || 500) / 2;
      updateTransform({
        scale,
        x: cx - ((cx - t.x) * scale) / t.scale,
        y: cy - ((cy - t.y) * scale) / t.scale,
      });
    },
    [updateTransform],
  );
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(viewport.current);
    fit();
    return () => observer.disconnect();
  }, [fit, list]);
  useEffect(() => {
    if (!viewport.current) return;
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      zoom(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [list, zoom]);
  function changeFocus(id: string) {
    setSearch('');
    onFocus(id);
  }
  const matches = search
    ? data.people.filter((p) => searchPeople(p, search)).slice(0, 8)
    : [];
  return (
    <section className="tree-experience">
      <header className="tree-heading">
        <div>
          <button className="tree-back" onClick={onBack}>
            <ArrowLeftIcon size={16} />
            Back to the family
          </button>
          <h1>Family tree</h1>
          <p>Relatives of {person.name}</p>
        </div>
        <div className="tree-search" ref={searchRoot}>
          <label>
            <MagnifyingGlassIcon size={18} />
            <input
              aria-label="Find a person in the tree"
              placeholder="Find someone"
              ref={searchInput}
              aria-controls="tree-search-results"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {search && (
            <div
              className="tree-search-results"
              id="tree-search-results"
              ref={searchResults}
              aria-label="Matching people"
            >
              {matches.map((p) => (
                <button key={p.id} onClick={() => changeFocus(p.id)}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.id === focus
                      ? 'Selected person'
                      : relationships.get(p.id)?.label || lifespan(p)}
                  </small>
                </button>
              ))}
              {!matches.length && <p>No matching names.</p>}
            </div>
          )}
        </div>
      </header>
      <div className="tree-toolbar">
        <div className="tree-directions">
          {(['family', 'ancestors', 'descendants'] as Direction[]).map(
            (mode) => (
              <button
                key={mode}
                onClick={() => {
                  setDirection(mode);
                  setDepth(mode === 'family' ? 1 : 2);
                }}
                aria-pressed={direction === mode}
              >
                {mode === 'family'
                  ? 'Family'
                  : mode === 'ancestors'
                    ? 'Ancestors'
                    : 'Descendants'}
              </button>
            ),
          )}
        </div>
        {direction === 'family' ? (
          <div className="tree-circle-control" aria-label="Family circle">
            <button aria-pressed={depth === 1} onClick={() => setDepth(1)}>
              Immediate family
            </button>
            <button aria-pressed={depth >= 2} onClick={() => setDepth(2)}>
              With cousins
            </button>
          </div>
        ) : (
          <div className="depth-control">
            <span>Generations</span>
            <button
              disabled={depth <= 1}
              onClick={() => setDepth((d) => d - 1)}
              aria-label="Show fewer generations"
            >
              <MinusIcon size={15} />
            </button>
            <strong>{depth}</strong>
            <button
              disabled={depth >= 8}
              onClick={() => setDepth((d) => d + 1)}
              aria-label="Show more generations"
            >
              <PlusIcon size={15} />
            </button>
          </div>
        )}
        <button className="tree-list-toggle" onClick={() => setList(!list)}>
          {list ? (
            <TreeStructureIcon size={18} />
          ) : (
            <ListBulletsIcon size={18} />
          )}
          {list ? 'Show diagram' : 'Show family list'}
        </button>
      </div>
      <div className="tree-context">
        <span>
          Labels show how each person is related to {person.given.split(' ')[0]}
        </span>
        {direction === 'family' && cousins.length > 0 && (
          <button
            onClick={() => {
              setList(true);
              requestAnimationFrame(() => {
                cousinHeading.current?.scrollIntoView({
                  block: 'nearest',
                  behavior: reduce ? 'instant' : 'smooth',
                });
                cousinHeading.current?.focus({ preventScroll: true });
              });
            }}
          >
            Cousins ({cousins.length})<ArrowRightIcon size={15} />
          </button>
        )}
        {!list && (
          <div className="tree-legend" aria-label="Relationship lines">
            <span>
              <i />
              Parent and child
            </span>
            <span>
              <i className="partner-line" />
              Partners
            </span>
            {layout.links.some((link) => link.parentage === 'adopted') && (
              <span>
                <i className="adopted-line" />
                Adoption
              </span>
            )}
          </div>
        )}
      </div>
      {list ? (
        <div className="tree-readable">
          {direction === 'family' ? (
            <>
              <div className="tree-group-intro">
                <h2>Family groups</h2>
                <p>
                  People can appear with both their parents and their own
                  family.
                </p>
              </div>
              <div className="tree-family-groups">
                {groups.map((group) => (
                  <section className="tree-family-group" key={group.id}>
                    <header>
                      <p>{group.context}</p>
                      <h3>{group.title}</h3>
                      {group.events
                        .filter(
                          (event) =>
                            ['MARR', 'DIV'].includes(event.type) && event.date,
                        )
                        .map((event) => (
                          <span key={event.id} className="tree-family-event">
                            {event.label} {formatGedcomDate(event.date, true)}
                          </span>
                        ))}
                    </header>
                    <h4>
                      {group.children.length
                        ? 'Parents'
                        : group.events.some((event) => event.type === 'MARR')
                          ? 'Spouses'
                          : 'Partners'}
                    </h4>
                    <ul>
                      {group.parents.map((relative) => relativeRow(relative))}
                    </ul>
                    {group.children.length > 0 && (
                      <>
                        <h4>Children</h4>
                        <ul>
                          {group.children.map((relative) =>
                            relativeRow(relative, group.id),
                          )}
                        </ul>
                      </>
                    )}
                  </section>
                ))}
              </div>
              {cousins.length > 0 && (
                <section className="tree-cousins">
                  <h2 ref={cousinHeading} tabIndex={-1}>
                    Cousins
                  </h2>
                  <ul>{cousins.map((relative) => relativeRow(relative))}</ul>
                </section>
              )}
              {layout.nodes.some((node) => !groupedIds.has(node.id)) && (
                <section className="tree-ungrouped">
                  <h2>Other relatives in view</h2>
                  <ul>
                    {layout.nodes
                      .filter((node) => !groupedIds.has(node.id))
                      .map((node) => relativeRow(byId.get(node.id)!))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            [...new Set(layout.nodes.map((node) => node.generation))].map(
              (generation) => (
                <section className="tree-generation-group" key={generation}>
                  <h2>
                    {generation === 0
                      ? 'Selected person'
                      : `${Math.abs(generation)} generation${Math.abs(generation) === 1 ? '' : 's'} ${generation < 0 ? 'earlier' : 'later'}`}
                  </h2>
                  <ul>
                    {layout.nodes
                      .filter((node) => node.generation === generation)
                      .map((node) => relativeRow(byId.get(node.id)!))}
                  </ul>
                </section>
              ),
            )
          )}
        </div>
      ) : (
        <div
          className={`tree-viewport ${dragging ? 'dragging' : ''}`}
          ref={viewport}
          role="application"
          tabIndex={0}
          aria-label="Family tree. Drag to move, use zoom controls, or choose the readable list."
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const delta: Record<string, [number, number]> = {
              ArrowLeft: [60, 0],
              ArrowRight: [-60, 0],
              ArrowUp: [0, 60],
              ArrowDown: [0, -60],
            };
            if (delta[e.key]) {
              e.preventDefault();
              const t = current.current;
              updateTransform({
                ...t,
                x: t.x + delta[e.key][0],
                y: t.y + delta[e.key][1],
              });
            }
            if (e.key === '+' || e.key === '=') zoom(1.2);
            if (e.key === '-') zoom(1 / 1.2);
            if (e.key === '0') fit(true);
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            beginGesture();
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.current.size >= 2 && pinch.current) {
              const [a, b] = [...pointers.current.values()];
              const start = pinch.current;
              if (start.distance < 1) {
                beginGesture();
                return;
              }
              const scale = Math.max(
                0.01,
                Math.min(
                  2.5,
                  (start.transform.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
                    start.distance,
                ),
              );
              const bounds = e.currentTarget.getBoundingClientRect();
              updateTransform({
                scale,
                x:
                  (a.x + b.x) / 2 -
                  bounds.left -
                  ((start.x - start.transform.x) * scale) /
                    start.transform.scale,
                y:
                  (a.y + b.y) / 2 -
                  bounds.top -
                  ((start.y - start.transform.y) * scale) /
                    start.transform.scale,
              });
            } else if (drag.current) {
              // A touch release can arrive before React runs this update.
              // Capture the position now; pointerup/cancel may clear the ref.
              const x = drag.current.tx + e.clientX - drag.current.x;
              const y = drag.current.ty + e.clientY - drag.current.y;
              updateTransform({
                ...current.current,
                x,
                y,
              });
            }
          }}
          onPointerUp={(e) => endPointer(e.pointerId)}
          onPointerCancel={(e) => endPointer(e.pointerId)}
          onLostPointerCapture={(e) => endPointer(e.pointerId)}
        >
          <motion.div
            className="tree-world"
            animate={transform}
            transition={
              dragging || reduce ? { duration: 0 } : { duration: 0.18 }
            }
            style={{
              width: layout.width,
              height: layout.height,
              transformOrigin: '0 0',
            }}
          >
            <svg
              className="tree-lines"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {coupleLinks.map(({ a, b, child, parentage }) => {
                // One line from the middle of the couple to their child.
                const pa = positions.get(a)!,
                  pb = positions.get(b)!,
                  to = positions.get(child)!;
                const x1 = pa.x + TREE_CARD_WIDTH + 36,
                  y1 = (pa.y + pb.y) / 2 + TREE_CARD_HEIGHT / 2,
                  x2 = to.x,
                  y2 = to.y + TREE_CARD_HEIGHT / 2;
                return (
                  <path
                    key={`${a}-${b}-${child}-couple`}
                    d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    className={`${parentage === 'adopted' ? 'adopted-line' : ''} ${[a, b, child].includes(focus) ? 'focus-line' : ''}`}
                  />
                );
              })}
              {layout.links
                .filter(
                  (link) =>
                    link.kind !== 'parent' || !coupleChildren.has(link.to),
                )
                .map((link) => {
                  const from = positions.get(link.from)!,
                    to = positions.get(link.to)!;
                  const partner = link.kind === 'partner';
                  const x1 = from.x + TREE_CARD_WIDTH,
                    y1 = from.y + TREE_CARD_HEIGHT / 2,
                    x2 = partner ? to.x + TREE_CARD_WIDTH : to.x,
                    y2 = to.y + TREE_CARD_HEIGHT / 2;
                  const curve = partner
                    ? `M ${x1} ${y1} C ${x1 + 48} ${y1}, ${x2 + 48} ${y2}, ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
                  return (
                    <path
                      key={`${link.from}-${link.to}-${link.kind}`}
                      d={curve}
                      fill="none"
                      className={`${partner ? 'partner-line' : ''} ${link.parentage === 'adopted' ? 'adopted-line' : ''} ${link.from === focus || link.to === focus ? 'focus-line' : ''}`}
                    />
                  );
                })}
            </svg>
            {layout.nodes.map((node) => {
              const p = byId.get(node.id)!;
              return (
                <motion.div
                  className={`tree-person ${node.id === focus ? 'focused' : ''}`}
                  key={node.id}
                  initial={{ opacity: 0 }}
                  animate={{ x: node.x, y: node.y, opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.18 }}
                >
                  <button
                    className="tree-person-main"
                    onClick={() => onPerson(p.id)}
                  >
                    {portrait(p)}
                    <span>
                      <strong>{p.name}</strong>
                      <small>{relationshipLabel(p)}</small>
                    </span>
                  </button>
                  <button
                    className="tree-focus-person"
                    onClick={() => changeFocus(p.id)}
                    aria-label={`Explore ${p.name}’s family`}
                    title={`Explore ${p.given.split(' ')[0]}’s family`}
                  >
                    <CrosshairSimpleIcon size={19} />
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
          <div className="tree-zoom">
            <button onClick={() => zoom(1.2)} aria-label="Zoom in">
              <PlusIcon size={20} />
            </button>
            <button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
              <MinusIcon size={20} />
            </button>
            <button
              onClick={() => fit()}
              aria-label="Center on the selected person"
            >
              <CrosshairSimpleIcon size={20} />
            </button>
            <button
              onClick={() => fit(true)}
              aria-label="Fit all relatives in view"
            >
              <CornersOutIcon size={20} />
            </button>
          </div>
          <div className="tree-hint">Drag to explore</div>
        </div>
      )}
      <footer className="tree-focus-bar">
        <span className="focus-monogram">
          {person.given[0]}
          {person.surname[0]}
        </span>
        <div>
          <small>Selected person</small>
          <strong>{person.name}</strong>
        </div>
        <button onClick={() => onPerson(person.id)}>
          <BookOpenTextIcon size={17} />
          View details
          <ArrowRightIcon size={17} />
        </button>
      </footer>
    </section>
  );
}
