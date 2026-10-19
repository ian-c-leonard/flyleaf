#!/usr/bin/env python3
"""Native Book boundary regressions; no authored or generated inputs are edited."""
import base64
from copy import deepcopy
import hashlib
import io
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import booklib
import flyleaf_settings
import website_book_parity as parity
import website_native_book as web
from website_book_parity import Expected, Actual, compare


def document(text):
    return '<html><head><title>Test</title></head><body>' + text + '</body></html>'


class NativeBookTests(unittest.TestCase):
    def test_section_people_adds_reviewed_membership_without_rewriting_other_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'book/sketches/0001-tamsin.typ'
            path.parent.mkdir(parents=True)
            path.write_text('// ---\n// refn: tamsin\n// covers: [tamsin]\n// ---\nPreserved manuscript.\n')
            tree = SimpleNamespace(by_refn={person: {} for person in ['tamsin', 'jory', 'nora', 'outside']})
            sections = [{'anchor': 'nar-tamsin', 'people': ['tamsin', 'parent']},
                        {'anchor': 'other', 'people': ['other-person']}]
            entry = {'anchor': 'nar-tamsin', 'people': ['tamsin', 'jory', 'nora'],
                     'manuscript': 'book/sketches/0001-tamsin.typ', 'sha256': web.digest(path)}
            selections = {'sectionPeople': [entry]}
            admitted = {'tamsin', 'jory', 'nora'}
            original = deepcopy(sections)
            with patch.object(web, 'ROOT', root):
                web.add_section_people(sections, selections, tree, admitted)
                self.assertEqual(sections[0]['people'], ['jory', 'nora', 'parent', 'tamsin'])
                self.assertEqual(sections[1], original[1])
                self.assertEqual(web.booklib.parse_front_matter(path)[0]['covers'], ['tamsin'])
                variants = [
                    {'anchor': 'missing'}, {'people': ['missing']},
                    {'people': ['outside']}, {'people': ['tamsin', 'tamsin']},
                    {'people': []}, {'people': 'tamsin'}, {'sha256': '0' * 64},
                    {'sha256': 'invalid'}, {'manuscript': '../outside.typ'},
                    {'manuscript': 'book/sketches/missing.typ'}, {'unknown': True},
                    {'anchor': 'other'},
                ]
                for change in variants:
                    with self.subTest(change=change), self.assertRaises(ValueError):
                        web.add_section_people(deepcopy(original), {'sectionPeople': [entry | change]}, tree, admitted)
                for invalid in [{'sectionPeople': [entry, entry]}, {'sectionPeople': {}},
                                selections | {'unsupported': True}]:
                    with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                        web.add_section_people(deepcopy(original), invalid, tree, admitted)

    def test_web_book_uses_the_typst_that_built_the_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / 'typst'
            other.write_text('#!/bin/sh\necho "typst 0.14.2 (b33de9de)"\n')
            other.chmod(0o755)
            receipt = {'toolchain': {'typst': 'typst 0.14.2 (b33de9de)',
                                     'typstSha256': '0' * 64}}
            with patch.dict(web.os.environ, {'FLYLEAF_TYPST': str(other)}):
                with self.assertRaises(ValueError):
                    web.find_compiler(receipt)
                receipt['toolchain']['typstSha256'] = web.digest(other)
                self.assertEqual(web.find_compiler(receipt), other.resolve())
                receipt['toolchain']['typst'] = 'typst 0.13.1 (8ace67d9)'
                with self.assertRaises(ValueError):
                    web.find_compiler(receipt)

    @unittest.skipUnless(shutil.which('typst'), 'Typst is required')
    def test_print_recto_break_adds_no_empty_html_paragraph(self):
        source = f'#import "{web.booklib.TEMPLATE_IMPORT}": *'.encode() + b'''
#show: book.with(title: "Fixture", author: "Fixture author")
= Methods
Preserved methods text.#footnote[Preserved source note.]
#set page(numbering: "1")
#part-page("Part I", "The Narrative", restart: true)
= First chapter
Preserved narrative text.
'''
        with_break = source.replace(b'#set page(', b'#recto-break()\n#set page(')
        typst = shutil.which('typst')
        version = subprocess.run([typst, '--version'], capture_output=True, text=True, check=True)
        receipt = {'toolchain': {'typst': version.stdout.strip(),
                                'typstSha256': web.digest(Path(typst).resolve()),
                                'creationTimestamp': 1789862400}}
        with tempfile.TemporaryDirectory(prefix='native-recto-test-', dir=web.ROOT) as tmp:
            work = Path(tmp)
            expected = web.BookHTML().parse(web.compile_book(source, receipt, work)).html()
            actual = web.BookHTML().parse(web.compile_book(with_break, receipt, work)).html()
        self.assertEqual(actual, expected)

    def test_bounded_ancestry_columns_preserve_cells_and_qualified_dates(self):
        values = ['no.', 'person', 'born', 'died', '122', 'Jenifer A. Polkinghorne',
                  '17 Nov 1806', 'between 1881 and 1883']
        cells = [{'func': 'cell', 'body': {'func': 'text', 'text': value}}
                 for value in values]
        table = {'func': 'table', 'columns': ['auto', '1.4fr', '1fr', '1fr'],
                 'children': [{'func': 'header', 'children': cells[:4]}, *cells[4:]]}
        expected = Expected(table)
        html = ('<table><thead><tr>' + ''.join('<th>' + x + '</th>' for x in values[:4])
                + '</tr></thead><tbody><tr>' + ''.join('<td>' + x + '</td>' for x in values[4:])
                + '</tr></tbody></table><section role="doc-endnotes"><ol></ol></section>')
        compare(expected, Actual(document(html), expected))
        for changed, error in ((html.replace('between 1881 and 1883', '1882'), ValueError),
                               (html.replace('<td>17 Nov 1806</td>', ''), AssertionError),
                               (html.replace('<td>122</td>', '<td>122</td><td>122</td>'), AssertionError)):
            with self.assertRaises(error):
                compare(expected, Actual(document(changed), expected))
        table['columns'] = ['auto', 'auto', 'auto', 'auto']
        with self.assertRaises(AssertionError):
            Expected(table)

    def test_continuous_sketch_anchor_preserves_text_and_rejects_unknown_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            sketch = Path(tmp) / 'book/sketches/0001-arne-solberg.typ'
            sketch.parent.mkdir(parents=True)
            sketch.write_text('// ---\n// refn: arne-solberg\n// continuous: true\n// ---\n'
                              '== Arne and Hilda in Minneapolis\n')
            body = {'func': 'sequence', 'children': [
                {'func': 'metadata', 'label': '<nar-arne-solberg>', 'value': None},
                {'func': 'text', 'text': 'Arne and Hilda in Minneapolis'}]}
            # The continuous openings are read once from the family's sketches.
            parity.continuous_openings.cache_clear()
            self.addCleanup(parity.continuous_openings.cache_clear)
            with patch.object(parity.booklib, 'ROOT', Path(tmp)):
                self.assertEqual(Expected(body).main, 'Arne and Hilda in Minneapolis')
                body['children'][0]['label'] = '<nar-unreviewed-family>'
                with self.assertRaises(AssertionError):
                    Expected(body)

    def test_stale_draft_note_names_the_fix(self):
        body = {'func': 'block', 'stroke': {'left': '1.5pt + rgb("#a8481a")'},
                'inset': {'left': '0% + 1em'},
                'body': {'func': 'text', 'text': 'The sketch is older than its people.'}}
        with self.assertRaisesRegex(ValueError, 'flyleaf coverage --mark-all'):
            Expected(body)

    def test_a_book_with_no_footnotes_has_no_notes_section(self):
        body = {'func': 'sequence', 'children': [{'func': 'text', 'text': 'Alice was born in 1950.'}]}
        expected = Expected(body)
        compare(expected, Actual(document('<p>Alice was born in 1950.</p>'), expected))
        noted = {'func': 'sequence', 'children': [
            {'func': 'text', 'text': 'Alice was born in 1950.'},
            {'func': 'footnote', 'body': {'func': 'text', 'text': 'A register.'}}]}
        expected = Expected(noted)
        with self.assertRaises(AssertionError):  # a book with a note still needs its section
            Actual(document('<p>Alice was born in 1950.<a role="doc-noteref" href="#n1" id="r1">1</a></p>'),
                   expected)

    def test_only_typ_stories_are_read_for_continuous_openings(self):
        with tempfile.TemporaryDirectory() as tmp:
            sketches = Path(tmp) / 'book/sketches'
            sketches.mkdir(parents=True)
            (sketches / '0001-arne-solberg.typ').write_text(
                '// ---\n// refn: arne-solberg\n// continuous: true\n// ---\n== Arne\n')
            # A Mac writes .DS_Store into folders it shows; it is not text.
            (sketches / '.DS_Store').write_bytes(b'\x00\x00\x00\x01Bud1\x00\xff\xfe binary')
            (sketches / 'notes.md').write_text('// ---\n// refn: other\n// continuous: true\n// ---\n')
            parity.continuous_openings.cache_clear()
            self.addCleanup(parity.continuous_openings.cache_clear)
            with patch.object(parity.booklib, 'ROOT', Path(tmp)):
                self.assertEqual(parity.continuous_openings(), frozenset({'<nar-arne-solberg>'}))

    def test_grid_cells_need_their_own_blocks_and_raw_text_reads_as_written(self):
        cell = lambda text: {'func': 'cell', 'body': {'func': 'text', 'text': text}}
        grid = {'func': 'sequence', 'children': [
            {'func': 'grid', 'columns': 2, 'column-gutter': '1em', 'row-gutter': '1em',
             'children': [cell('A left cell'), cell('A right cell')]},
            {'func': 'raw', 'text': 'raw *text*', 'block': False}]}
        expected = Expected(grid)
        compare(expected, Actual(document(
            '<div><div>A left cell</div><div>A right cell</div></div><p><code>raw *text*</code></p>'),
            expected))
        # Cells joined without a break would run "cell" and "A" together.
        with self.assertRaises(ValueError):
            compare(expected, Actual(document(
                '<div>A left cellA right cell</div><p><code>raw *text*</code></p>'), expected))
        with self.assertRaises(AssertionError):
            Expected({'func': 'raw', 'text': 'a block of code', 'block': True})

    def test_story_markup_compares_as_the_words_it_prints(self):
        self.assertEqual(web.printed(r'Some *bold*, _italic_ and `raw *x* text`.'),
                         'Some bold, italic and raw *x* text.')
        self.assertEqual(web.printed(r'She paid \$300 for lot \#1 \@ the fair, a \*star\* and \_ too.'),
                         'She paid $300 for lot #1 @ the fair, a *star* and _ too.')

    def test_only_ancestors_carry_register_numbers_in_story_text(self):
        people = {'alice': {'xref': '@I1@', 'given': 'Alice', 'surname': 'Brown'},
                  'carl': {'xref': '@I4@', 'given': 'Carl', 'surname': 'Brown'}}
        tree = SimpleNamespace(by_refn=people)
        text = web.number_names('Alice Brown was the sister of Carl Brown.',
                                '#refp("alice") was the sister of #refp("carl").', tree,
                                {'@I1@': [1]})
        self.assertEqual(text, 'Alice Brown (no. 1) was the sister of Carl Brown.')

    def test_generated_display_labels_are_not_prose_but_draft_warnings_are(self):
        relationship = web.Node('div', {'data-book-display': 'relationship'},
                                ['Maternal seventh great-grandparents of the children.'])
        prose = web.Node('div', children=['The later genealogy disagrees about her given name.'])
        body = web.Node('root', children=[relationship, prose])
        self.assertEqual(web.prose_opening(list(body.nodes())), prose.text())
        warning = web.Node('div', children=[web.Node('em', children=[
            'The underlying records have been updated; revision pending.'])])
        body.children.insert(1, warning)
        self.assertEqual(web.prose_opening(list(body.nodes())), warning.text())
        endnotes = web.Node('section', {'role': 'doc-endnotes'}, [prose])
        self.assertEqual(web.prose_opening(list(endnotes.nodes())), '')
        with self.assertRaises(ValueError):
            web.BookHTML().parse(document('<div data-book-display="unknown">Text</div>'))

    def test_reading_openings_are_complete_section_local_and_exclude_reference_groups(self):
        heading = lambda ident, title, level='h3': web.Node(level, {'id': ident}, [title])
        heads = [heading('chapter', 'A chapter', 'h2'), heading('empty', 'Empty'),
                 heading('qualified', 'Qualified'), heading('register-references', 'References', 'h2'),
                 heading('reference-group', 'A reference group')]
        opening = 'The chronicle describes the household and a sequence of moves. ' * 4 + \
                  'Whether the family owned this particular cottage is still an open question.'
        relation = web.Node('div', {'data-book-display': 'relationship'}, ['A generated relationship label.'])
        contents = web.Node('nav', {'role': 'doc-toc'}, [
            web.Node('a', {'href': '#' + h.attrs['id']}, [h.text()]) for h in heads])
        body = web.Node('root', children=[contents, heads[0], heads[1], heads[2], relation,
            web.Node('div', children=[opening]), web.Node('p', children=['A later paragraph.']),
            heads[3], web.Node('p', children=['Inclusion here does not establish every fact.']),
            heads[4], web.Node('h4', {'id': 'sources-one'}, ['One']),
            web.Node('div', children=['Register entry: One.']),
            web.Node('div', children=['A compiled source citation.'])])
        selections = {'headingAnchors': [], 'highlights': ['qualified'], 'legacyRoutes': {}}
        before = body.html().replace(' data-book-display="relationship"', '')
        sections, _ = web.reading_sections(body, selections, SimpleNamespace(by_refn={}))
        self.assertEqual([s['anchor'] for s in sections], [h.attrs['id'] for h in heads])
        self.assertEqual([s['opening'] for s in sections],
                         ['', '', opening, 'Inclusion here does not establish every fact.', ''])
        self.assertTrue(sections[2]['excerpt'].endswith('…'))
        self.assertTrue(opening.startswith(sections[2]['excerpt'][:-1]))
        self.assertLess(len(sections[2]['excerpt']), len(opening))
        self.assertEqual(body.html(), before)

    def test_opening_uses_first_prose_block_not_a_later_p_or_display_caption(self):
        first = web.Node('div', children=['The chronicle reports the birthplace. ',
                                         web.Node('em', children=['The house identification remains uncertain.'])])
        body = web.Node('body', children=[
            web.Node('figure', children=[web.Node('figcaption', children=[web.Node('p', children=['A caption.'])])]),
            web.Node('table', children=[web.Node('tr', children=[web.Node('td', children=[web.Node('p', children=['A table.'])])])]),
            web.Node('ul', children=[web.Node('li', children=[web.Node('p', children=['A list item.'])])]),
            web.Node('div', children=[first, web.Node('p', children=['A much later paragraph.'])]),
        ])
        self.assertEqual(web.prose_opening(list(body.nodes())),
                         'The chronicle reports the birthplace. The house identification remains uncertain.')
        self.assertEqual(web.prose_opening([web.Node('p', children=['A conventional paragraph.'])]),
                         'A conventional paragraph.')
        self.assertEqual(web.prose_opening(list(body.children[0].nodes())), '')

    def test_opening_removes_only_separators_between_omitted_note_markers(self):
        note = lambda number: web.Node('a', {'role': 'doc-noteref'}, [web.Node('sup', children=[number])])
        paragraph = web.Node('div', children=['In the 19', web.Node('sup', children=['th']),
            ' century, the report said so. ', note('1'), web.Node('sup', children=[',']),
            web.Node('span', children=[' ']), note('2'), ' This remains uncertain, however.'])
        self.assertEqual(web.prose_opening([paragraph]),
                         'In the 19th century, the report said so. This remains uncertain, however.')
        paragraph.children.append(web.Node('sup', children=[',']))
        self.assertTrue(web.prose_opening([paragraph]).endswith('however.,'))
        self.assertEqual(web.prose_opening([web.Node('p', children=['two', note('3'), 'words'])]),
                         'two words')

    def test_import_derivation_is_exact_and_rejects_ambiguity(self):
        source = f'#import "{web.booklib.TEMPLATE_IMPORT}": *'.encode() + b'\nA preserved word: not.\n'
        out = web.derive(source)
        self.assertEqual(out.replace(b'web-template.typ', b'template.typ'), source)
        for invalid in (b'No template', source + source, source.replace(b'template.typ', b'web-template.typ')):
            with self.assertRaises(ValueError):
                web.derive(invalid)

    def test_rejects_unsupported_or_active_html_instead_of_stripping_it(self):
        for markup in ('<script>alert(1)</script>', '<canvas>Lost record</canvas>',
                       '<a href="javascript:alert(1)">source</a>', '<span onclick="x()">word</span>',
                       '<span style="background:url(https://example.com)">word</span>',
                       '<a href="https://user:password@example.com">source</a>', '<p>truncated'):
            with self.subTest(markup=markup), self.assertRaises(ValueError):
                web.BookHTML().parse(document(markup))

    def test_note_return_id_may_move_only_from_adjacent_whitespace(self):
        template = '<p>{}<a href="#note" role="doc-noteref"><sup>1</sup></a></p>' + \
            '<section role="doc-endnotes"><ol><li id="note"><a role="doc-backlink" href="#ref">1</a>Not proven.</li></ol></section>'
        body = web.BookHTML().parse(document(template.format('<span id="ref"> </span>')))
        marker = next(n for n in body.nodes() if n.attrs.get('role') == 'doc-noteref')
        self.assertEqual(marker.attrs['id'], 'ref')
        for span in ('<span id="ref">Not</span>', '<span id="ref"><em></em></span>',
                     '<span id="ref"> </span><span>unrelated</span>'):
            with self.subTest(span=span), self.assertRaises(ValueError):
                web.BookHTML().parse(document(template.format(span)))

    def test_note_return_id_accepts_only_adjacent_pure_nested_whitespace(self):
        # Actual pinned Typst output for a #src immediately following a figure.
        template = '<p>{}<a href="#note" role="doc-noteref"><sup>3</sup></a></p>' + \
            '<section role="doc-endnotes"><ol><li id="note"><a role="doc-backlink" href="#ref"><sup>3</sup></a>Family testimony.</li></ol></section>'
        space = '<span id="ref"><span style="white-space: pre-wrap"> </span></span>'
        body = web.BookHTML().parse(document(template.format(space)))
        marker = next(n for n in body.nodes() if n.attrs.get('role') == 'doc-noteref')
        self.assertEqual(marker.attrs['id'], 'ref')
        self.assertEqual(body.text(), ' 33Family testimony.')
        self.assertEqual(web.check_links(body)['footnotes'], 1)
        for invalid in (
            '<span id="ref"><span style="white-space: pre-wrap">Not proven</span></span>',
            '<span id="ref"><span id="elsewhere"> </span></span>',
            '<span id="ref"><em> </em></span>',
            '<span id="ref"><span style="font-variant-caps: small-caps"> </span></span>',
            '<span id="ref"><span style="white-space: pre-wrap"></span></span>',
            space + '<span>unrelated</span>',
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                web.BookHTML().parse(document(template.format(invalid)))

    def test_duplicate_or_broken_destinations_fail(self):
        for content in ('<h2 id="same">One</h2><h3 id="same">Two</h3>', '<a href="#missing">Family</a>'):
            with self.assertRaises(ValueError):
                web.BookHTML().parse(document(content))

    def test_unknown_warning_cannot_hide_dropped_content(self):
        source = '#set page(numbering: "1")\n'
        known = 'warning: html export is under active development and incomplete\nwarning: page set rule was ignored during HTML export\nwork/book.typ:1:1\n' + source
        web.compiler_warnings(known, source, 'work/book.typ')
        with self.assertRaises(ValueError):
            web.compiler_warnings(known + 'warning: grid cell was ignored\n', source, 'work/book.typ')
        with self.assertRaises(ValueError):
            web.compiler_warnings(known.replace(':1:1', ':2:1'), source, 'work/book.typ')

    def test_complete_wording_gate_catches_negation_and_joined_words(self):
        expected = Expected({'func': 'text', 'text': 'Parentage is not proven. Child 64 v.'})
        def actual(text):
            return Actual(document('<p>' + text + '</p><section role="doc-endnotes"><ol></ol></section>'), expected)
        compare(expected, actual('Parentage is not proven. Child 64 v.'))
        for corrupted in ('Parentage is proven. Child 64 v.', 'Parentage is not proven. Child 64v.'):
            with self.assertRaises(ValueError):
                compare(expected, actual(corrupted))
        with self.assertRaises(ValueError):
            Expected({'func': 'new-unsupported-container', 'body': {'func': 'text', 'text': 'Lost'}})

    def test_parity_cannot_be_disabled_by_optimized_python(self):
        result = subprocess.run([sys.executable, '-O', '-c', 'import website_book_parity'],
                                cwd=SCRIPTS, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('without optimization', result.stderr)

    def test_heading_depth_identity_and_wording_stay_in_order(self):
        expected = Expected({'func': 'sequence', 'children': [
            {'func': 'heading', 'depth': 1, 'label': '<ch-one>', 'body': {'func': 'text', 'text': 'First'}},
            {'func': 'heading', 'depth': 1, 'label': '<ch-two>', 'body': {'func': 'text', 'text': 'Second'}},
        ]})
        good = '<h2 id="ch-one">First</h2><h2 id="ch-two">Second</h2>'
        def actual(html):
            return Actual(document(html + '<section role="doc-endnotes"><ol></ol></section>'), expected)
        compare(expected, actual(good))
        for changed in (good.replace('h2', 'h3', 2),
                        good.replace('ch-one', 'swap').replace('ch-two', 'ch-one').replace('swap', 'ch-two'),
                        good.replace(' id="ch-one"', '')):
            with self.assertRaises(ValueError):
                compare(expected, actual(changed))

    def test_illustration_caption_order_and_chart_identities_are_bound(self):
        expected = Expected({'func': 'sequence', 'children': [
            {'func': 'figure', 'label': '<chart-one>', 'kind': 'image',
             'body': {'func': 'image', 'source': '/images/one.png'},
             'caption': {'func': 'caption', 'body': {'func': 'text', 'text': 'First portrait'}}},
            {'func': 'figure', 'label': '<chart-two>', 'kind': 'image',
             'body': {'func': 'image', 'source': '/images/two.png'},
             'caption': {'func': 'caption', 'body': {'func': 'text', 'text': 'Second portrait'}}},
        ]})
        assets = [{'source': 'images/one.png'}, {'source': 'images/two.png'}]
        web.check_image_positions(expected, assets)
        with self.assertRaisesRegex(ValueError, 'caption/figure order'):
            web.check_image_positions(expected, list(reversed(assets)))
        good = '<figure id="chart-one"><img><figcaption>Figure 1: First portrait</figcaption></figure><figure id="chart-two"><img><figcaption>Figure 2: Second portrait</figcaption></figure>'
        def actual(html):
            return Actual(document(html + '<section role="doc-endnotes"><ol></ol></section>'), expected)
        compare(expected, actual(good))
        with self.assertRaisesRegex(ValueError, 'figure identities'):
            compare(expected, actual(good.replace('chart-one', 'swap').replace('chart-two', 'chart-one').replace('swap', 'chart-two')))
        # Nothing links to these figures, so Typst may leave their ids out.
        compare(expected, actual(good.replace(' id="chart-one"', '')))

    def test_register_note_targets_preserve_the_exact_printed_entry(self):
        entry = '<div><span data-register-person="alice" data-register-key="census"></span>Original wording.<span data-book-person="alice" data-book-key="census"></span></div>'
        body = web.BookHTML().parse(document(entry))
        self.assertEqual(web.bind_citation_notes(body), 1)
        self.assertEqual(body.children[0].text(), 'Original wording.')
        self.assertEqual(body.children[0].attrs, {'id': 'book-note-1', 'data-book-note': ''})
        with self.assertRaisesRegex(ValueError, 'identity differs'):
            web.bind_citation_notes(web.BookHTML().parse(document(entry.replace('data-register-key="census"', 'data-register-key="other"'))))

    def test_exact_image_requires_admission_and_complete_inventory(self):
        from PIL import Image
        buffer = io.BytesIO()
        Image.new('RGB', (3, 4), 'white').save(buffer, format='PNG')
        data = buffer.getvalue()
        path = 'images/fixture.png'
        receipt = {'dependencies': {path: hashlib.sha256(data).hexdigest()}}
        def figure():
            return web.Node('body', children=[web.Node('figure', children=[
                web.Node('img', {'src': 'data:image/png;base64,' + base64.b64encode(data).decode()}),
                web.Node('figcaption', children=['Complete fixture'])])])
        with tempfile.TemporaryDirectory() as tmp, patch.object(web, 'ROOT', Path(tmp)), \
                patch.dict(os.environ, {'FLYLEAF_FAMILY': tmp}):
            root = Path(tmp)
            (root / path).parent.mkdir()
            (root / path).write_bytes(data)
            stage = root / 'stage'; (stage / path).parent.mkdir(parents=True)
            (stage / path).write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'not an admitted'):
                web.externalize_images(figure(), receipt, stage, set(), {})
            result = web.externalize_images(figure(), receipt, stage, {path}, {})
            self.assertEqual((result[0]['width'], result[0]['height']), (3, 4))
            extra = figure(); extra.children.append(web.Node('img', {'src': 'data:image/png;base64,' + base64.b64encode(data).decode()}))
            with self.assertRaisesRegex(ValueError, 'Unaccounted image'):
                web.externalize_images(extra, receipt, stage, {path}, {})

    def test_changed_pdf_inputs_reject_before_export(self):
        receipt = web.verify_receipt()
        changed = dict(receipt['inputs'])
        changed[flyleaf_settings.logical(booklib.SRC_GED)] = '0' * 64
        with patch('book_publication.inputs', return_value=changed), self.assertRaisesRegex(ValueError, 'Book inputs changed'):
            web.verify_receipt()

    def test_charts_reject_external_paint_css_and_foreign_namespaces(self):
        valid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20">{}</svg>'
        self.assertEqual(web.image_dimensions(valid.format('<rect fill="#fff"/>').encode(), '.svg'), (10, 20))
        for svg in (valid.format('<rect fill="url(https://example.com/a#x)"/>'),
                    valid.format(r'<rect fill="u\72l(https://example.com/a#x)"/>'),
                    valid.replace('viewBox=', 'style="background-image:url(https://example.com)" viewBox=').format(''),
                    valid.format('<text xmlns="urn:other">Not SVG text</text>')):
            with self.assertRaises(ValueError):
                web.image_dimensions(svg.encode(), '.svg')


def setUpModule():
    # Typst fixtures import the template, which imports the family's fonts.
    booklib.stage_templates()


if __name__ == '__main__':
    unittest.main()
