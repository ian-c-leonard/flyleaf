"""Print-size descent panels. Geometry is in points; text is never scaled down.

The full chapter graph is divided at repeated people, not at arbitrary rows.
Every edge appears in a panel, with numbered continuations in both directions.
"""
from collections import Counter
from html import escape
import json
from pathlib import Path
import hashlib

from PIL import ImageFont

import booklib
import flyleaf_settings

# The text column (the trim width in book.yaml less the side margins), and the
# tallest chart that leaves room for its caption: 313.2pt and 396pt on 6 × 9.
_PAGE = booklib.page_settings()
WIDTH = _PAGE['text_width_pt']
MAX_HEIGHT = _PAGE['figure_height_pt']
FONT_SIZE = 9
LEADING = 11
GAP_X, GAP_Y, PAD = 10, 27, 6
# Charts are measured and lettered in the book's first serif face.
FONT_PATH = booklib.font_settings()['chart_file']
FONT_FAMILY = booklib.font_settings()['serif'][0]


date_year = booklib.date_year
lifespan = booklib.lifespan


def name(person):
    return booklib.person_name(person)


def chapter_graph(tree, table, lines, shown=None, repeats=None):
    """The chapter's chart graph. Lines come from the whole table; only the
    numbers in `shown` are drawn, and a repeated ancestor (`repeats`, number ->
    first number) says where their earlier generations are."""
    shown = table if shown is None else shown
    repeats = repeats or {}
    numbers = {n for n in table if n in shown and tree.line_of(n, table) in lines}
    numbers.update(n for n in (1, 2, 3) if n in table)
    # Include intervening people: a connector must never skip a generation.
    for number in list(numbers):
        while number > 1:
            number //= 2
            numbers.add(number)
    owner = {n: n - 1 if n > 1 and n % 2 and n - 1 in numbers else n for n in numbers}
    nodes = {}
    for n in sorted(numbers):
        key = owner[n]
        p = tree.by_xref[table[n]]
        node = nodes.setdefault(key, {'n': key, 'generation': tree.generation(key),
                                      'people': [], 'siblings': [], 'parent_nodes': []})
        node['people'].append({'n': n, 'refn': p['refn'], 'name': name(p), 'years': lifespan(p),
                               **({'see': repeats[n]} if n in repeats else {})})
    edges = []
    for key, node in nodes.items():
        if key == 1:
            root = tree.by_xref[table[1]]
            fam = tree.fams.get(root.get('famc'))
            children = tree.children_of_family(fam) if fam else [root]
            node['root_children'] = [{'refn': p['refn'], 'name': name(p)} for p in children]
            continue
        child_n = key // 2
        target = owner[child_n]
        edge = {'parent': key, 'child': target, 'child_person': child_n}
        edges.append(edge)
        nodes[target]['parent_nodes'].append(key)
        # Other children belong to the family that links this parent to the
        # direct child, not to every marriage of either parent.
        direct = tree.by_xref[table[child_n]]
        fam = tree.fams.get(direct.get('famc'))
        if fam and key != 2:
            kids = tree.children_of_family(fam)
            firsts = Counter((p.get('given') or '').split()[0] for p in kids if p.get('given'))
            for p in kids:
                if p['xref'] == direct['xref']:
                    continue
                label = booklib.person_name(p, include_surname=False) if p.get('given') else name(p)
                if firsts.get(label.split()[0], 0) > 1 and p.get('birth_date'):
                    label += ' (' + date_year(p['birth_date']) + ')'
                node['siblings'].append({'refn': p['refn'], 'name': name(p), 'label': label})
    return {'nodes': nodes, 'edges': edges}


class Typesetter:
    def __init__(self, font_path=FONT_PATH):
        if not Path(font_path).is_file():
            raise ValueError(f'Print chart font is missing: {font_path}; install the book font before building')
        self.font = ImageFont.truetype(str(font_path), FONT_SIZE * 100)

    def length(self, value):
        return self.font.getlength(value) / 100

    def wrap(self, text, width):
        lines, current = [], ''
        for word in text.split():
            if current and self.length(current + ' ' + word) > width:
                lines.append(current)
                current = ''
            while self.length(word) > width:
                cut = next(i for i in range(1, len(word) + 1) if self.length(word[:i]) > width) - 1
                if not cut:
                    raise ValueError('Chart column cannot hold one glyph')
                if current:
                    lines.append(current)
                    current = ''
                lines.append(word[:cut])
                word = word[cut:]
            current = (current + ' ' + word).strip()
        if current:
            lines.append(current)
        return lines

    def node_lines(self, node, width, continuation=False):
        result = []
        if node['n'] == 1:
            for child in node['root_children']:
                result.extend((line, 'name') for line in self.wrap(child['name'], width))
            return result
        for person in node['people']:
            result.extend((line, 'name') for line in self.wrap(f"{person['n']}. {person['name']}", width))
            if person['years']:
                result.extend((line, 'date') for line in self.wrap(person['years'], width))
            if person.get('see'):
                result.extend((line, 'date') for line in self.wrap(f"See no. {person['see']}.", width))
        if node['siblings']:
            text = 'Other children shown: ' + '; '.join(p['label'] for p in node['siblings'])
            if not text.endswith('.'):
                text += '.'
            result.extend((line, 'siblings') for line in self.wrap(text, width))
        if continuation:
            result.append(('See chart 999', 'continuation'))  # reserve a full line
        return result


def panel_nodes(graph, focus, depth):
    included, frontier = {focus}, {focus}
    for _ in range(depth):
        frontier = {p for n in frontier for p in graph['nodes'][n]['parent_nodes']}
        included.update(frontier)
    if focus == 2 and 1 in graph['nodes']:
        included.add(1)
    return included


def panel_geometry(graph, focus, included, typesetter):
    rows = {}
    for n in included:
        rows.setdefault(graph['nodes'][n]['generation'], []).append(n)
    positions, y = {}, 4
    for generation, row in sorted(rows.items(), reverse=True):
        row.sort()
        # Wide single/couple columns preserve breathing room; four-column
        # ancestor rows wrap at the same fixed 9pt type size.
        width = min(205, (WIDTH - GAP_X * (len(row) - 1)) / len(row))
        x0 = (WIDTH - len(row) * width - GAP_X * (len(row) - 1)) / 2
        height = 0
        for i, n in enumerate(row):
            node = graph['nodes'][n]
            more = any(p not in included for p in node['parent_nodes'])
            lines = typesetter.node_lines(node, width - 2 * PAD, more)
            h = 2 * PAD + LEADING * len(lines)
            positions[n] = {'x': x0 + i * (width + GAP_X), 'y': y,
                            'width': width, 'height': h, 'lines': lines, 'continues': more}
            height = max(height, h)
        y += height + GAP_Y
    return {'positions': positions, 'height': y - GAP_Y + 4}


def plan_panels(graph, typesetter, first_number=1):
    # The first panel carries the present family and two earlier generations.
    focus = 2 if 2 in graph['nodes'] else 1
    queue, seen, panels = [focus], set(), []
    while queue:
        focus = queue.pop(0)
        if focus in seen:
            continue
        seen.add(focus)
        for depth in (2, 1):
            included = panel_nodes(graph, focus, depth)
            geometry = panel_geometry(graph, focus, included, typesetter)
            if geometry['height'] <= MAX_HEIGHT:
                break
        else:
            raise ValueError(f'Chart at register no. {focus} exceeds a print page at 9pt; revise panel layout')
        more = sorted(n for n in included if any(p not in included for p in graph['nodes'][n]['parent_nodes']))
        queue.extend(more)
        panels.append({'number': first_number + len(panels), 'focus': focus,
                       'nodes': sorted(included), 'geometry': geometry, 'earlier': more})
    by_focus = {p['focus']: p['number'] for p in panels}
    for p in panels:
        p['earlier'] = {n: by_focus[n] for n in p['earlier']}
        later = [q['number'] for q in panels if p['focus'] in q['earlier']]
        p['later'] = later
    return panels


def render_panel(graph, panel):
    geometry, included = panel['geometry'], set(panel['nodes'])
    pos = geometry['positions']
    height = geometry['height']
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}pt" height="{height}pt" '
           f'viewBox="0 0 {WIDTH} {height}" font-family="{escape(FONT_FAMILY)}" font-size="{FONT_SIZE}">']
    edges = [e for e in graph['edges'] if e['parent'] in included and e['child'] in included]
    svg.append('<metadata>' + escape(json.dumps({'nodes': panel['nodes'], 'edges': edges,
                                               'font_points': FONT_SIZE})) + '</metadata>')
    for edge in edges:
        parent, child = pos[edge['parent']], pos[edge['child']]
        person_ns = [p['n'] for p in graph['nodes'][edge['child']]['people']]
        port = .5 if len(person_ns) == 1 else (.25 if edge['child_person'] == person_ns[0] else .75)
        x1, y1 = parent['x'] + parent['width'] / 2, parent['y'] + parent['height']
        x2, y2 = child['x'] + child['width'] * port, child['y']
        mid = y2 - GAP_Y / 2
        svg.append(f'<path d="M{x1},{y1} V{mid} H{x2} V{y2}" stroke="#A8481A" stroke-width="0.8" fill="none"/>')
    for n in panel['nodes']:
        box = pos[n]
        x, y, width, h = (box[k] for k in ('x', 'y', 'width', 'height'))
        svg.append(f'<rect x="{x}" y="{y}" width="{width}" height="{h}" rx="3" fill="#FBFAF7" stroke="#B9B4A5" stroke-width="0.6"/>')
        for i, (line, kind) in enumerate(box['lines']):
            if kind == 'continuation':
                line = f"See chart {panel['earlier'][n]}"
            color = '#315049' if kind in ('siblings', 'continuation') else '#1E2124'
            svg.append(f'<text x="{x + PAD}" y="{y + PAD + FONT_SIZE + i * LEADING}" fill="{color}">{escape(line)}</text>')
    svg.append('</svg>')
    return '\n'.join(svg)


def validate_panels(graph, panels, typesetter):
    """Reject dropped edges, missing continuations, overlaps, or clipped labels."""
    included = {n for p in panels for n in p['nodes']}
    if included != set(graph['nodes']):
        raise ValueError('Print panels do not preserve the complete chapter graph')
    expected = {(e['parent'], e['child'], e['child_person']) for e in graph['edges']}
    shown = {(e['parent'], e['child'], e['child_person'])
             for p in panels for e in graph['edges']
             if e['parent'] in p['nodes'] and e['child'] in p['nodes']}
    if expected != shown:
        raise ValueError('Print panels drop a parent–child link')
    by_number = {p['number']: p for p in panels}
    for p in panels:
        if p['geometry']['height'] > MAX_HEIGHT:
            raise ValueError('Chart is too tall at the required print size')
        for n, earlier in p['earlier'].items():
            if earlier not in by_number or by_number[earlier]['focus'] != n:
                raise ValueError('Chart continuation points to the wrong person')
            if p['number'] not in by_number[earlier]['later']:
                raise ValueError('Chart continuation has no return link')
        for n, box in p['geometry']['positions'].items():
            if box['x'] < 0 or box['x'] + box['width'] > WIDTH + .001:
                raise ValueError('Chart box extends beyond the print width')
            for line, kind in box['lines']:
                if kind == 'continuation':
                    line = f"See chart {p['earlier'][n]}"
                if typesetter.length(line) > box['width'] - 2 * PAD + .001:
                    raise ValueError(f'Chart text exceeds its box: {line}')
        boxes = list(p['geometry']['positions'].values())
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                if (max(a['x'], b['x']) < min(a['x'] + a['width'], b['x'] + b['width'])
                        and max(a['y'], b['y']) < min(a['y'] + a['height'], b['y'] + b['height'])):
                    raise ValueError('Print chart boxes overlap')


def inputs_digest(tree, cfg=None):
    files = [tree.src_path, booklib.BOOK_YAML, Path(__file__),
             booklib.HERE / 'booklib.py', booklib.HERE / 'enrich-gedcom.py', FONT_PATH]
    result = {flyleaf_settings.logical(p): hashlib.sha256(Path(p).read_bytes()).hexdigest()
              for p in files}
    cfg = cfg or booklib.load_book_yaml()
    cfg = booklib.resolve_chapters(cfg, tree)
    result['configuration'] = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()
    result['repeated_ancestors'] = 'once' if booklib.repeated_ancestors_once() else 'every_line'
    return result


def load_manifest(tree, directory=None, cfg=None):
    directory = directory or booklib.ROOT / 'build' / 'figures'
    manifest = json.loads((directory / 'print-charts.json').read_text())
    if manifest.get('inputs') != inputs_digest(tree, cfg):
        raise ValueError('Print charts are stale; run flyleaf book')
    for chapter in manifest['chapters'].values():
        for panel in chapter['panels']:
            if hashlib.sha256((directory / panel['file']).read_bytes()).hexdigest() != panel['sha256']:
                raise ValueError(f"Print chart has changed: {panel['file']}; run flyleaf book")
    return manifest


def generate(tree=None, cfg=None, directory=None):
    tree = tree or booklib.Tree()
    cfg = cfg or booklib.load_book_yaml()
    table = tree.ahnentafel(booklib.root_refn(cfg))
    cfg = booklib.resolve_chapters(cfg, tree, table)  # each chapter's lines written out
    typesetter = Typesetter()
    directory = directory or booklib.ROOT / 'build' / 'figures'
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {'width_pt': WIDTH, 'font_pt': FONT_SIZE, 'inputs': inputs_digest(tree, cfg), 'chapters': {}}
    shown, repeats = booklib.first_appearances(table) if booklib.repeated_ancestors_once() else (table, {})
    number = 1
    for chapter in cfg['chapters']:
        if chapter.get('charts') == 'false':
            continue
        graph = chapter_graph(tree, table, chapter.get('lines', []), shown, repeats)
        panels = plan_panels(graph, typesetter, number)
        validate_panels(graph, panels, typesetter)
        for panel in panels:
            filename = f"chart-{chapter['id']}-{panel['focus']}.svg"
            rendered = render_panel(graph, panel)
            (directory / filename).write_text(rendered)
            panel['file'] = filename
            panel['sha256'] = hashlib.sha256(rendered.encode()).hexdigest()
        manifest['chapters'][chapter['id']] = {'graph': graph, 'panels': panels}
        number += len(panels)
    (directory / 'print-charts.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    manifest = generate()
    for key, chapter in manifest['chapters'].items():
        print(key, len(chapter['graph']['nodes']), 'nodes;', len(chapter['panels']), 'panels;',
              [p['geometry']['height'] for p in chapter['panels']])
