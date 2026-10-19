#!/usr/bin/env python3
"""Check actual footnote entry starts against their in-text anchor pages.

Query both footnote.entry and the template's <fn-check> metadata. The entry's
own location measures its first page; a marker after its content measures the
last page and can conceal a note starting before its anchor. Count actual
entries too, so missing/partial instrumentation cannot silently pass.

It also warns about a page that holds nothing but the end of a footnote
carried over from the page before (it reads the PDF beside book.typ).

Usage: check-footnotes.py [build/book.typ]
Exit: 0 checked, 1 layout/query/instrumentation failure.
"""
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
import flyleaf_settings

ROOT = flyleaf_settings.family_root()
SELECTOR = 'selector(footnote.entry).or(<fn-check>)'


def check_entries(elements, expected=True):
    """Return entry count and diagnostic errors from a final-layout query.
    `expected` is False only when the book's text has no footnote at all,
    as in a tree with no sources yet; then zero entries is the right answer."""
    count = sum(e.get("func") == "entry" for e in elements)
    checks = [e.get("value") for e in elements
              if e.get("func") == "metadata" and e.get("label") == "<fn-check>"]
    errors = []
    if expected and (not count or not checks):
        errors.append("zero footnote entries or <fn-check> records; the check cannot run")
    if len(checks) != count:
        errors.append(f"{count} footnote entries but {len(checks)} check records; "
                      "instrumentation is incomplete")
    for value in checks:
        if (not isinstance(value, dict)
                or any(type(value.get(k)) is not int or value[k] < 1
                       for k in ("entry_start", "anchor", "number"))):
            errors.append("invalid <fn-check> record; require entry_start, anchor, "
                          "and number (old end-page markers are not sufficient)")
            continue
        if value["entry_start"] < value["anchor"]:
            # Typst can set a note a page early when the text that cites it
            # breaks across pages (github.com/typst/typst/issues/5314).
            errors.append(f"footnote {value['number']} starts on PDF page "
                          f"{value['entry_start']} before its anchor on PDF page "
                          f"{value['anchor']}: keep the text that cites it on one page")
    return count, errors


def stranded_notes(pdf, margins, starts=()):
    """Pages where no footnote starts and whose text, apart from the running
    head and the page number, lies wholly in the lower half, with no picture:
    the page holds only the end of a footnote from the page before.
    `starts` are the pages where footnotes start. Returns (page, printed page)."""
    words = subprocess.run(["pdftotext", "-bbox", str(pdf), "-"], capture_output=True,
                           text=True, check=True).stdout
    listed = subprocess.run(["pdfimages", "-list", str(pdf)], capture_output=True,
                            text=True, check=True).stdout
    pictured = {int(line.split()[0]) for line in listed.splitlines()[2:] if line.split()}
    found = []
    xhtml = "{http://www.w3.org/1999/xhtml}"
    for number, page in enumerate(ET.fromstring(words).iter(xhtml + "page"), 1):
        height = float(page.get("height"))
        head, foot = margins["top"] * 72, height - margins["bottom"] * 72
        body, folio = [], ""
        for word in page.iter(xhtml + "word"):
            top, bottom = float(word.get("yMin")), float(word.get("yMax"))
            if bottom <= head:
                continue
            if top >= foot:
                folio += word.text or ""
            else:
                body.append(top)
        if body and min(body) > height / 2 and number not in pictured | set(starts):
            found.append((number, folio or "?"))
    return found


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    src = Path(args[0]) if args else ROOT / "build" / "book.typ"
    try:
        proc = subprocess.run(
            ["typst", "query", str(src), SELECTOR, "--root", str(ROOT)],
            capture_output=True, text=True)
    except OSError as exc:
        sys.stderr.write(f"check-footnotes: query failed: {exc}\n")
        return 1
    if proc.returncode != 0:
        sys.stderr.write(f"check-footnotes: typst query failed:\n{proc.stderr}")
        return 1
    try:
        elements = json.loads(proc.stdout)
        count, errors = check_entries(elements, expected="#footnote" in src.read_text())
    except (ValueError, TypeError, AttributeError) as exc:
        sys.stderr.write(f"check-footnotes: invalid query result: {exc}\n")
        return 1
    if errors:
        for error in errors:
            sys.stderr.write(f"check-footnotes: FAIL — {error}\n")
        return 1
    pdf = src.with_suffix(".pdf")
    if pdf.is_file():
        import booklib  # the page margins
        starts = {e["value"]["entry_start"] for e in elements if e.get("label") == "<fn-check>"}
        for number, printed in stranded_notes(pdf, booklib.MARGINS_IN, starts):
            sys.stderr.write(f"check-footnotes: warning — PDF page {number} (printed {printed}) "
                             "holds only the end of a footnote from the page before. Shorten "
                             "that note, or the text before it.\n")
    print(f"check-footnotes: OK — {count} footnotes, every entry starts on or "
          "after its anchor page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
