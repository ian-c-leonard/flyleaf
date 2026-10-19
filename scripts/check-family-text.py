#!/usr/bin/env python3
"""Flag research-process language in text that family members read.

Family-facing text (book prose and captions, photograph titles,
descriptions and credits) describes people, places and occasions. Evidence,
identification notes and research limits belong in the Sources sections.

Built in, this warns about phrases that usually mean research notes have
reached family text. A family can name its own phrases that stop a deploy
(text_checks in flyleaf.json); see family_patterns below.

Usage: scripts/check-family-text.py [--warnings]
Exit status 1 when an error-level phrase is found outside the exempt files.
"""
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flyleaf_settings  # noqa: E402

ROOT = flyleaf_settings.family_root()

# The compiler's name and the authors the family's sources cite (flyleaf.json).
# A new family may not have named its maintainer yet; then {maintainer} matches nothing.
MAINTAINER = re.escape(flyleaf_settings.get('maintainer.first_name') or '') or '(?!)'
CITED_AUTHORS = '|'.join(
    re.escape(a) for a in flyleaf_settings.get('text_checks.cited_authors', [])) or '(?!)'


def family_patterns(name):
    """A family's own phrases that stop a deploy (text_checks.<name> in
    flyleaf.json): regular expressions, matched without regard to case.
    {maintainer} stands for the maintainer's first name and {cited_authors}
    for the authors in text_checks.cited_authors."""
    patterns = flyleaf_settings.get(f'text_checks.{name}', [])
    if not isinstance(patterns, list) or not all(isinstance(p, str) and p for p in patterns):
        raise SystemExit(f'flyleaf.json: text_checks.{name} must be a list of patterns')
    return [p.replace('{maintainer}', MAINTAINER).replace('{cited_authors}', CITED_AUTHORS)
            for p in patterns]


# Phrases that stop a deploy: the family's own. Checked in book prose and
# captions, photograph text and notes on events.
ERRORS = family_patterns('errors')
# Notes on events show on profiles without their source; a family may stop
# them from narrating it.
EVENT_NOTE_ERRORS = family_patterns('event_note_errors')
# Phrases that usually mean research notes have reached family text. They warn.
GENERAL_WARNINGS = [
    rf'\b{MAINTAINER} (supplied|identified|identifies|recalled|described|reports?)\b',
    r'\b(has|have) not been (examined|inspected|verified|identified|established|located|confirmed)\b',
    rf'\bpending\b.*\b{MAINTAINER}\b',
    # Vague family memory: say what the record shows, or name the printed account.
    r'\bfamily (remembers|remembered|recalls|recalled|tradition (holds|says|has it))\b|'
    r'\bfamily lore\b|\baccording to (the )?family\b|'
    r'\b(is|are|was|were) remembered (in|for|as having)\b',
]
# Phrases that usually mean the text is narrating its source. Review them.
WARNINGS = [
    r'\b(notice|obituary|census|index|register|entry|certificate|profile|article|announcement|'
    r'biography|directory|newsletter|caption|yearbook|programme|program)s? (gives|records|reports|'
    r'lists|names|identifies|places|describes|supplies|credits|found)\b',
    r'\baccording to (his|her|the|their)\b',
    r'\bpublished with (his|her) (obituary|notice)\b',
    r'\bdoes not (identify|establish|name|specify|give|state)\b',
    r'\b(undated|unidentified|unknown|unverified|unconfirmed)\b',
]
# Chapters about the research itself may discuss evidence; they only warn.
# The family names them by title in flyleaf.json (book.research_sections).
RESEARCH_TITLES = flyleaf_settings.get('book.research_sections', [])
if not isinstance(RESEARCH_TITLES, list):
    raise SystemExit('flyleaf.json: book.research_sections must be a list of chapter titles')
# The book's own folders, inside paths.book.
BOOK = flyleaf_settings.folder_name('book')
BOOK_FOLDERS = tuple(f'{BOOK}/{name}' for name in
                     ('sketches', 'chapters', 'front-matter', 'back-matter'))


def book_files():
    for folder in BOOK_FOLDERS:
        yield from (p for p in sorted((ROOT / folder).glob('*.typ')) if not p.name.startswith('.'))


def chapter_title(path):
    """The text of a book file's chapter heading (its first `= ` line)."""
    for line in path.read_text().splitlines():
        match = re.match(r'=\s+(.+)$', line.strip())
        if match:
            return ' '.join(match[1].split())
    return ''


def research_files():
    """The book files whose chapter title is listed as a research section,
    and any listed title that no book file has."""
    titles = {' '.join(str(title).split()) for title in RESEARCH_TITLES}
    found = {path.relative_to(ROOT).as_posix(): chapter_title(path) for path in book_files()}
    exempt = {name for name, title in found.items() if title in titles}
    return exempt, sorted(titles - set(found.values()))


def without_footnotes(text):
    """Footnotes are source notes, where evidence belongs; skip their text."""
    out, depth, i = [], 0, 0
    while i < len(text):
        if depth == 0 and text.startswith('#footnote[', i):
            depth, i = 1, i + len('#footnote[')
            continue
        if depth:
            depth += {'[': 1, ']': -1}.get(text[i], 0)
        else:
            out.append(text[i])
        i += 1
    return ''.join(out)


def book_lines():
    for path in book_files():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            stripped = line.strip()
            if not stripped or stripped.startswith('//'):
                continue
            # Citation keys and image paths are not reader text.
            text = re.sub(r'#src\("[^"]*"\)|#refp\("[^"]*"\)|image\("[^"]*"\)|#fig\("[^"]*"', '',
                          without_footnotes(line))
            yield path.relative_to(ROOT).as_posix(), number, text


def edition_lines():
    path = flyleaf_settings.path('site_content') / 'edition.ged'
    if not path.is_file():  # the family has no site overlay
        return
    for number, line in enumerate(path.read_text().splitlines(), 1):
        match = re.match(r'1 (TITL|_PUBLIC_NOTE|_CREDIT|_OTHER_SUBJECT) (.*)', line)
        if match:
            yield path.relative_to(ROOT).as_posix(), number, match[2]


def event_note_lines():
    """Notes on events (births, deaths, marriages) show on family profiles."""
    path = flyleaf_settings.path('source_gedcom')
    record = parent = None
    skip = {'NAME', 'SOUR', 'NOTE', 'OBJE', 'FAMC', 'FAMS', 'REFN'}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if line.startswith('0 '):
            parts = line.split()
            record, parent = (parts[2] if len(parts) > 2 else ''), None
        elif line.startswith('1 '):
            parent = line.split()[1]
        elif line.startswith('2 NOTE ') and record in ('INDI', 'FAM') and parent not in skip:
            yield path.relative_to(ROOT).as_posix(), number, line[len('2 NOTE '):]


# Internal tree labels that must never print anywhere in the built book,
# including text the assembler generates from the data.
INTERNAL_LABELS = r'Evidence tier|\btree-link\b|\[Confidence\]|_CONFLEVEL|\[Notes\]|\[TODO\]|' \
    r'\[Source\]|\b(compiled|authoritative)-secondary\b|\bfamily-testimony\b|\(Unclassified\.\)'

# Phrases a family stops from printing anywhere in the built book, such as
# its own research shorthand (text_checks.printed_book_errors).
PRINTED_BOOK_ERRORS = family_patterns('printed_book_errors')


def built_book_lines():
    """The printed PDF, so generated register text is checked too."""
    import shutil
    import subprocess
    pdf = ROOT / 'build/book.pdf'
    if not pdf.exists() or not shutil.which('pdftotext'):
        return
    text = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], capture_output=True,
                          text=True, check=True).stdout
    for number, line in enumerate(text.splitlines(), 1):
        yield 'build/book.pdf', number, line


def main():
    show_warnings = '--warnings' in sys.argv
    errors = warnings = 0
    exempt, missing = research_files()
    for title in missing:
        errors += 1
        print(f'flyleaf.json: error: book.research_sections names “{title}”, '
              'but no book chapter has that title.')
    for name, number, text in built_book_lines():
        match = re.search(INTERNAL_LABELS, text)
        if match:
            errors += 1
            print(f'{name}:{number}: error: internal label “{match[0]}” in: {text.strip()[:140]}')
        for pattern in PRINTED_BOOK_ERRORS:
            match = re.search(pattern, text, re.I)
            if match:
                errors += 1
                print(f'{name}:{number}: error: “{match[0]}” in: {text.strip()[:140]}')
    notes = {(name, number) for name, number, _ in event_note_lines()}
    for name, number, text in [*book_lines(), *edition_lines(), *event_note_lines()]:
        errors_here = ERRORS + EVENT_NOTE_ERRORS if (name, number) in notes else ERRORS
        for level, patterns in (('error', errors_here), ('warning', GENERAL_WARNINGS + WARNINGS)):
            for pattern in patterns:
                match = re.search(pattern, text, re.I)
                if not match:
                    continue
                actual = 'warning' if name in exempt else level
                if actual == 'error':
                    errors += 1
                else:
                    warnings += 1
                if actual == 'error' or show_warnings:
                    print(f'{name}:{number}: {actual}: “{match[0]}” in: {text.strip()[:140]}')
                break
    hint = ' Run flyleaf coverage --wording to see them.' if warnings and not show_warnings else ''
    print(f'{errors} family-text error(s), {warnings} warning(s).{hint}')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
