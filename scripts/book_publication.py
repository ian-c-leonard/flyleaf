"""Build-receipt contract for the family-produced PDF, not historical evidence."""
import hashlib
import json
import re
from pathlib import Path

import booklib
import flyleaf_settings

ROOT = booklib.ROOT
RECEIPT = ROOT / 'build/book-publication.json'
# Every script the book build runs or imports. A test checks that nothing the
# build loads is missing here.
CODE = ('build-book.py', 'book_publication.py', 'book-assemble.py', 'book-coverage.py',
        'book-figures.py', 'bookcharts.py', 'bookbib.py', 'booklib.py', 'ascii_ids.py', 'build_clock.py',
        'flyleaf_settings.py', 'enrich-gedcom.py', 'validate-gedcom.py', 'source_tiers.py',
        'gedcom_confidence.py',
        'extract-claims.py', 'check-footnotes.py', 'check-register-sources.py',
        'check-bibliography.py', 'check-charts.py')
# The flyleaf.json sections the book build reads: the book's own settings, the
# family's folders, place wording and the people the source checks skip.
# book.description appears only on the website.
SETTINGS = ('book', 'paths', 'places', 'research')
# The only fonts the compiler may use: book.fonts.files in flyleaf.json.
FONTS = tuple(booklib.font_settings()['files'])


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def snapshot(paths):
    return {flyleaf_settings.logical(path): digest(path)
            for path in sorted(set(Path(p).absolute() for p in paths))}


def settings_digest():
    """The flyleaf.json settings that can change the book, as one digest."""
    chosen = {name: flyleaf_settings.get(name) for name in SETTINGS}
    chosen['book'] = {k: v for k, v in (chosen['book'] or {}).items() if k != 'description'}
    return hashlib.sha256(json.dumps(chosen, sort_keys=True).encode()).hexdigest()


def inputs():
    """Recompute both membership and bytes, including Python-read figure geometry."""
    paths = [booklib.SRC_GED, booklib.BOOK_YAML, booklib.SYNC_JSON,
             booklib.BOOK_DIR / 'bibliography-policy.json', booklib.ENGINE / 'Makefile',
             booklib.TEMPLATES / 'template.typ',
             *(booklib.ENGINE / 'scripts' / name for name in CODE)]
    tiers = flyleaf_settings.get('paths.source_tier_patterns')
    if tiers:
        paths.append(ROOT / tiers)  # the family's own rules for sorting its sources
    prose = sorted({p for folder in ('sketches', 'chapters', 'front-matter', 'back-matter')
                    for p in booklib.typ_files(booklib.BOOK_DIR / folder)})
    paths.extend(prose)
    for path in prose:
        # Comment lines (//) are notes to the writer, such as a stub's example.
        text = '\n'.join(line for line in path.read_text().splitlines()
                         if not line.lstrip().startswith('//'))
        for name in re.findall(r'#fig\("([^"\n]+)"', text):
            figure = booklib.figure_path(name)
            if figure is None or not figure.is_file():
                raise ValueError(f'Book figure missing: {name}')
            paths.append(figure)
    return {**snapshot(paths), 'flyleaf.json (book settings)': settings_digest()}


def require_equal(before, after, label):
    if before != after:
        changed = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
        raise booklib.Stop(f'{label} changed since the book was built. Run flyleaf book, '
                           'then build the site again. Changed: ' + ', '.join(changed[:12]))


def seal(receipt):
    payload = {k: v for k, v in receipt.items() if k != 'integritySha256'}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def verify_receipt(path=RECEIPT, native=booklib.SRC_GED, root=None):
    receipt = json.loads(Path(path).read_text())
    if receipt.get('schema') != 1 or receipt.get('status') != 'checked-build':
        raise booklib.Stop('Build the book first: run flyleaf book.')
    if receipt.get('integritySha256') != seal(receipt):
        raise booklib.Stop('The record of the last book build does not match; run flyleaf book.')
    require_equal(receipt['inputs'], inputs(), 'Book inputs')
    require_equal(receipt['toolchain']['fonts'], snapshot(FONTS), 'Book fonts')
    if not booklib.FONTS_TYP.is_file() or booklib.FONTS_TYP.read_text() != booklib.font_module():
        raise booklib.Stop('The book typefaces in flyleaf.json changed; run flyleaf book.')
    if not booklib.PAGE_TYP.is_file() or booklib.PAGE_TYP.read_text() != booklib.page_module():
        raise ValueError('The page size changed in book.yaml; run flyleaf book')
    if receipt.get('checks') != ['footnotes', 'register-sources', 'bibliography', 'charts']:
        raise ValueError('Book receipt lacks the required checks')
    if not {'build/book.typ', 'build/flyleaf/template.typ', 'build/figures/print-charts.json'}.issubset(receipt['dependencies']):
        raise ValueError('Book receipt lacks required rendering dependencies')
    cfg = booklib.load_book_yaml()
    tree = booklib.Tree(native)
    root_person = tree.by_refn[cfg['root_refn']]
    if (receipt['nativeSha256'] != digest(native) or receipt['rootRefn'] != cfg['root_refn']
            or receipt['rootXref'] != root_person['xref'] or (root and root != receipt['rootXref'])):
        raise ValueError('Book and website must use the same native genealogy and family root')
    for name, expected in receipt['dependencies'].items():
        path = flyleaf_settings.locate(name)
        if (Path(name).is_absolute() or '..' in Path(name).parts or not path.is_file()
                or digest(path) != expected):
            raise ValueError(f'Stale book dependency: {name}; run flyleaf book')
    book = receipt['book']
    pdf = ROOT / 'build/book.pdf'
    if (not re.fullmatch(r'[a-f0-9]{64}', book['sha256'])
            or digest(pdf) != book['sha256'] or pdf.stat().st_size != book['bytes']
            or type(book['pages']) is not int or book['pages'] <= 0
            or book['title'] != cfg['title'] or book['subtitle'] != cfg.get('subtitle', '')
            or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', book['editionDate'])
            or book['path'] != f"publications/{book['sha256']}/{flyleaf_settings.require('book.pdf_name')}"):
        raise ValueError('Book PDF or publication metadata changed; run flyleaf book')
    return receipt
