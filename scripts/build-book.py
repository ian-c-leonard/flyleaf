#!/usr/bin/env python3
"""Build, check and receipt one PDF from stable inputs. Never edits authored prose."""
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import booklib
import build_clock
import flyleaf_settings

SOURCE_GEDCOM = flyleaf_settings.path('source_gedcom')
PDF_NAME = flyleaf_settings.require('book.pdf_name')
from book_publication import ROOT, FONTS, digest, inputs, require_equal, snapshot, seal

ENGINE = booklib.ENGINE


def run(args, env, capture=False):
    result = subprocess.run([str(arg) for arg in args], cwd=ROOT, env=env, check=True,
                            text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout


def install(stage, build_dir):
    """Receipt installs last; failed rollback retains a separate recovery directory."""
    names = ('book.typ', 'book.pdf', 'book-publication.json')
    backup = Path(tempfile.mkdtemp(prefix='.book-previous-', dir=build_dir))
    try:
        for name in names:
            target = build_dir / name
            if target.exists():
                shutil.copyfile(target, backup / name)
    except BaseException:
        shutil.rmtree(backup)
        raise
    try:
        for name in names:
            target = build_dir / name
            (stage / name).replace(target)
    except BaseException:
        try:
            # A filesystem operation may finish before an interrupt reaches
            # Python. Restore the whole backed-up set, including that case.
            for name in reversed(names):
                target = build_dir / name
                if (backup / name).exists():
                    (backup / name).replace(target)
                else:
                    target.unlink(missing_ok=True)
        except BaseException as rollback:
            raise RuntimeError(f'Restore the previous book from {backup}') from rollback
        shutil.rmtree(backup)
        raise
    shutil.rmtree(backup)


def acquire_lock(lock, stale_after=120):
    """Take the build lock. Reclaim it only when the build that holds it is gone.

    A concurrent build must not mutate our generated figures. A build that was
    killed leaves its lock behind; the recorded process id tells the two apart.
    """
    try:
        lock.mkdir()
    except FileExistsError as busy:
        try:
            owner = int((lock / 'pid').read_text())
        except (FileNotFoundError, ValueError):
            owner = None
        if owner is None:
            # No owner recorded: reclaim only once the lock is clearly old.
            if datetime.now().timestamp() - lock.stat().st_mtime < stale_after:
                raise busy
        else:
            try:
                os.kill(owner, 0)
            except ProcessLookupError:
                pass
            except PermissionError:
                raise busy
            else:
                raise busy
        shutil.rmtree(lock)
        lock.mkdir()
    (lock / 'pid').write_text(str(os.getpid()))


def build():
    build_dir = ROOT / 'build'
    build_dir.mkdir(exist_ok=True)
    lock = build_dir / '.book-publication-lock'
    acquire_lock(lock)
    try:
        with tempfile.TemporaryDirectory(prefix='.book-publication-', dir=build_dir) as directory:
            stage = Path(directory)
            # SOURCE_DATE_EPOCH pins the edition date and the PDF timestamp, so
            # a pinned rebuild reproduces the published bytes exactly.
            pinned = build_clock.epoch() is not None
            edition_date = build_clock.today()
            timestamp = str(int(build_clock.now_utc().timestamp()))
            before = inputs()
            fonts = snapshot(FONTS)
            env = dict(os.environ)
            font_dir = stage / 'fonts'
            font_dir.mkdir()
            for source in FONTS:
                shutil.copyfile(source, font_dir / source.name)
                if digest(source) != digest(font_dir / source.name):
                    raise ValueError('Font changed during copy')
            staged_fonts = snapshot(font_dir.iterdir())
            env.update(TYPST_FONT_PATHS=str(font_dir), TYPST_IGNORE_SYSTEM_FONTS='true',
                       TYPST_IGNORE_EMBEDDED_FONTS='true', SOURCE_DATE_EPOCH=timestamp)
            typst = Path(shutil.which('typst') or '')
            if not typst.is_file():
                raise ValueError('Typst is required on PATH')
            booklib.stage_templates()
            toolchain = {'typst': run(['typst', '--version'], env, True).strip(),
                         'typstSha256': digest(typst), 'python': sys.version,
                         'pillow': importlib.metadata.version('Pillow'),
                         'pythonGedcom': importlib.metadata.version('python-gedcom'),
                         'fonts': fonts, 'creationTimestamp': int(timestamp),
                         'fontSearch': 'only the recorded template font families and variants'}
            booklib.check_typst_version(toolchain['typst'])
            # The engine's Makefile and scripts, working on this family's folder,
            # even when this build runs inside another make (its settings
            # would otherwise reach this one).
            env['FLYLEAF_FAMILY'] = str(ROOT)
            env['PYTHON'] = sys.executable
            for name in ('MAKEFLAGS', 'MFLAGS', 'MAKELEVEL'):
                env.pop(name, None)
            run(['make', '-C', ENGINE, 'validate', 'book-figures'], env)
            generated = snapshot([ROOT / 'build/figures/print-charts.json'])
            run([sys.executable, ENGINE / 'scripts/book-coverage.py', '--quiet'], env)
            # The text may use only the markup the claim map can read. Check it
            # now, so a story the map would refuse never replaces the book.
            run([sys.executable, ENGINE / 'scripts/extract-claims.py', '--validate'], env)
            entry, pdf, deps = (stage / name for name in ('book.typ', 'book.pdf', 'deps.json'))
            run([sys.executable, ENGINE / 'scripts/book-assemble.py', '--out', entry], env)
            require_equal(before, inputs(), 'Assembly inputs')

            def compile_pdf():
                run(['typst', 'compile', '--root', ROOT, '--creation-timestamp', timestamp,
                     '--deps', deps, '--deps-format', 'json', entry, pdf], env)

            def dependencies():
                paths = [ROOT / p for p in json.loads(deps.read_text())['inputs']]
                if any(not p.resolve().is_relative_to(ROOT) for p in paths):
                    raise ValueError('Compiler dependency leaves the repository')
                return snapshot(paths)

            compile_pdf()  # Discover imports/images; this is not the receipted pass.
            dep_before = dependencies()
            compile_pdf()
            compiled_pdf = snapshot([pdf])
            compiled_bytes = pdf.stat().st_size
            require_equal(dep_before, dependencies(), 'Compiler dependencies')
            for name in ('footnotes', 'register-sources', 'bibliography', 'charts'):
                run([sys.executable, ENGINE / f'scripts/check-{name}.py', entry], env)
            require_equal(compiled_pdf, snapshot([pdf]), 'Compiled PDF')
            require_equal(before, inputs(), 'Book inputs')
            require_equal(dep_before, dependencies(), 'Compiler dependencies')
            require_equal(fonts, snapshot(FONTS), 'Fonts')
            require_equal(staged_fonts, snapshot(font_dir.iterdir()), 'Staged fonts')
            require_equal(generated, snapshot([flyleaf_settings.locate(p) for p in generated]),
                          'Generated chart manifest')
            if digest(typst) != toolchain['typstSha256'] or (
                    not pinned and date.today() != edition_date):
                raise ValueError('Compiler or local edition date changed during build; retry')
            info = run(['pdfinfo', pdf], env, True)
            pages = re.search(r'^Pages:\s+(\d+)\s*$', info, re.M)
            if not pages:
                raise ValueError('Cannot read compiled PDF page count')
            cfg = booklib.load_book_yaml()
            sha = next(iter(compiled_pdf.values()))
            normalized_deps = dict(dep_before)
            normalized_deps.update(generated)
            normalized_deps['build/book.typ'] = normalized_deps.pop(str(entry.relative_to(ROOT)))
            receipt = {'schema': 1, 'status': 'checked-build',
                       'createdAt': build_clock.now_utc().isoformat(),
                       'nativeSha256': before[str(SOURCE_GEDCOM.relative_to(ROOT))],
                       'rootRefn': cfg['root_refn'],
                       'rootXref': booklib.Tree().by_refn[cfg['root_refn']]['xref'],
                       'inputs': before, 'dependencies': normalized_deps, 'toolchain': toolchain,
                       'checks': ['footnotes', 'register-sources', 'bibliography', 'charts'],
                       'book': {'title': cfg['title'], 'subtitle': cfg.get('subtitle', ''),
                                'editionDate': edition_date.isoformat(), 'sha256': sha,
                                'path': f'publications/{sha}/{PDF_NAME}',
                                'bytes': compiled_bytes, 'pages': int(pages[1])}}
            receipt['integritySha256'] = seal(receipt)
            (stage / 'book-publication.json').write_text(json.dumps(receipt, indent=2) + '\n')
            require_equal(compiled_pdf, snapshot([pdf]), 'Compiled PDF before installation')
            if pdf.stat().st_size != compiled_bytes:
                raise ValueError('Compiled PDF length changed before installation')
            install(stage, build_dir)
            print(f'→ build/book.pdf ({receipt["book"]["pages"]} pages), checked; the build is recorded '
                  'so the website can tell if the book is out of date.')
    finally:
        shutil.rmtree(lock)


# Other editions of the built book: the archival PDF (PDF/A-2b, for library
# deposit) and pictures of its first pages.
EDITIONS = {
    '--archival': (['--pdf-standard', 'a-2b', 'build/book.typ', 'build/book-archival.pdf'],
                   'build/book-archival.pdf (PDF/A-2b)'),
    '--preview': (['--format', 'png', '--pages', '1-8', '--ppi', '110', 'build/book.typ',
                   'build/preview-{p}.png'], 'build/preview-*.png'),
}


def edition(option):
    """Compile build/book.typ again, set in exactly the book's fonts: the
    font files in flyleaf.json, never the fonts this computer has installed."""
    arguments, made = EDITIONS[option]
    with tempfile.TemporaryDirectory(prefix='.book-fonts-', dir=ROOT / 'build') as directory:
        for source in FONTS:
            shutil.copyfile(source, Path(directory) / source.name)
        env = dict(os.environ, TYPST_FONT_PATHS=directory, TYPST_IGNORE_SYSTEM_FONTS='true',
                   TYPST_IGNORE_EMBEDDED_FONTS='true')
        pinned = build_clock.epoch()
        run(['typst', 'compile', '--root', ROOT,
             *(['--creation-timestamp', str(pinned)] if pinned is not None else []), *arguments], env)
    print(f'→ {made}')


if __name__ == '__main__':
    option = sys.argv[1:]
    if option and option not in [[name] for name in EDITIONS]:
        sys.exit('usage: build-book.py [--archival | --preview]')
    try:
        edition(option[0]) if option else build()
    except subprocess.CalledProcessError:
        # The step that failed has said why.
        previous = (booklib.ROOT / 'build' / 'book.pdf').exists()
        sys.exit('That edition was not made.' if option else
                 'The book was not built' + ('; the previous book is unchanged.' if previous else '.'))
