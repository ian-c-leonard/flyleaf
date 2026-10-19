#!/usr/bin/env python3
"""Shared library for the family-history book pipeline (book-*.py scripts).

Provides:
- GEDCOM loading via the same parsing code as enrich-gedcom.py (imported,
  not duplicated), against the family's source GEDCOM (paths.source_gedcom)
- REFN <-> person indexes and FAM structures
- Ahnentafel walk from a root person (book/book.yaml `root_refn`)
- Line (surname-lineage) computation for chapter assignment
- slugify() for stable source-label citation keys
- person_hash() for staleness tracking against the SSOT text

This module never writes any file.
"""
import hashlib
import importlib.util
import json
import os
import re
import sys
from collections import OrderedDict
from pathlib import Path

import ascii_ids  # noqa: E402
import flyleaf_settings  # noqa: E402
import source_tiers  # noqa: E402

HERE = Path(__file__).resolve().parent
# ROOT is the family folder (content and build output); ENGINE holds the code.
ROOT = flyleaf_settings.family_root()
ENGINE = flyleaf_settings.ENGINE
SRC_GED = flyleaf_settings.path("source_gedcom")
TEMPLATES = ENGINE / "book"


# Typst reads only inside the family folder (its --root). The build copies
# Flyleaf's templates into build/flyleaf/, with the family's fonts beside
# them, so Flyleaf itself can be installed anywhere.
STAGED_TEMPLATES = ROOT / "build" / "flyleaf"
TEMPLATE_IMPORT = "/build/flyleaf/template.typ"
WEB_TEMPLATE_IMPORT = "/build/flyleaf/web-template.typ"
FONTS_TYP = STAGED_TEMPLATES / "fonts.typ"
PAGE_TYP = STAGED_TEMPLATES / "page.typ"
_DEFAULT_FONTS = {
    "serif": ["Libertinus Serif"],
    "sans": ["Libertinus Sans"],
    "files": sorted(str(p) for p in (TEMPLATES / "fonts").glob("*.otf")),
    "chart_file": str(TEMPLATES / "fonts" / "LibertinusSerif-Regular.otf"),
}


def _font_file(name):
    path = Path(os.path.expanduser(name))
    return path if path.is_absolute() else ROOT / path


def font_settings():
    """The book's typefaces (book.fonts in flyleaf.json): serif and sans
    family names in fallback order, the font files the compiler may use, and
    the file of the first serif face, which family charts are measured with.
    Without settings, the open Libertinus fonts bundled with Flyleaf."""
    chosen = flyleaf_settings.get("book.fonts") or {}
    fonts = {key: chosen.get(key) or _DEFAULT_FONTS[key] for key in _DEFAULT_FONTS}
    fonts["files"] = [_font_file(f) for f in fonts["files"]]
    fonts["chart_file"] = _font_file(fonts["chart_file"])
    return fonts


# The alphabets the bundled Libertinus fonts have.
_FONT_SCRIPTS = ("LATIN", "GREEK", "CYRILLIC", "HEBREW")


def letters_the_fonts_lack(texts):
    """Letters in texts that the bundled fonts do not have, such as those of a
    Chinese name. The book would print them as empty boxes."""
    import unicodedata
    return {ch for text in texts for ch in (text or "")
            if ch.isalpha() and not unicodedata.name(ch, "").startswith(_FONT_SCRIPTS)}


def font_environment(env=None):
    """Environment for Typst runs outside the PDF build (checks, the web book):
    it may also read the folders holding the book's font files."""
    env = dict(os.environ if env is None else env)
    folders = sorted({str(path.parent) for path in font_settings()["files"]})
    env["TYPST_FONT_PATHS"] = os.pathsep.join(filter(None, [env.get("TYPST_FONT_PATHS"), *folders]))
    return env


def font_module():
    """The Typst module the template imports for its typefaces."""
    fonts = font_settings()
    names = lambda key: "(" + ", ".join(json.dumps(n) for n in fonts[key]) + ",)"
    return (f"// Generated from flyleaf.json (book.fonts). Do not edit.\n"
            f"#let serif = {names('serif')}\n#let sans = {names('sans')}\n")


def check_typst_version(reported):
    """Stop when Typst is not the version flyleaf.json names (book.typst.version).
    `reported` is the output of `typst --version`, such as "typst 0.14.2 (b33de9de)"."""
    wanted = flyleaf_settings.get("book.typst.version")
    words = reported.split()
    if wanted and (len(words) < 2 or words[0] != "typst" or words[1] != wanted):
        raise SystemExit(f"This book needs Typst {wanted}; found {reported!r}")


def stage_templates():
    """Copy the templates into build/flyleaf/ and write the font and page
    modules beside them, changing only files that are missing or out of date."""
    STAGED_TEMPLATES.mkdir(parents=True, exist_ok=True)
    wanted = {FONTS_TYP: font_module().encode(), PAGE_TYP: page_module().encode()}
    for name in ("template.typ", "web-template.typ"):
        wanted[STAGED_TEMPLATES / name] = (TEMPLATES / name).read_bytes()
    for path, data in wanted.items():
        if not path.is_file() or path.read_bytes() != data:
            path.write_bytes(data)
    return STAGED_TEMPLATES

# The family's book folder (paths.book) and its images folder.
BOOK_DIR = flyleaf_settings.folder("book")
IMAGES_DIR = flyleaf_settings.folder("images")
BOOK_YAML = BOOK_DIR / "book.yaml"
SKETCH_DIR = BOOK_DIR / "sketches"


def typ_files(folder):
    """The story files in a book folder, in order. A hidden file, such as the
    ._name.typ copies macOS leaves on some drives, is never a story."""
    folder = Path(folder)
    return sorted(p for p in folder.glob("*.typ") if not p.name.startswith(".")) if folder.is_dir() else []
SYNC_JSON = BOOK_DIR / ".gedcom-sync.json"


def _load_module(filename, modname):
    spec = importlib.util.spec_from_file_location(modname, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_enrich = _load_module("enrich-gedcom.py", "enrich_gedcom")

classify_source = source_tiers.classify_source
parse_note = _enrich.parse_note


def person_name(person, *, include_surname=True):
    """Display the recorded suffix after the name; keep given names intact."""
    parts = [person.get("given") or ""]
    if include_surname:
        parts.append(person.get("surname") or "")
    parts.append(person.get("suffix") or "")
    return " ".join(part for part in parts if part).strip()


def index_name(person):
    """Surname-first index key, including the suffix in its display portion."""
    return ((person.get("surname") or "").strip(),
            person_name(person, include_surname=False))


# GEDCOM calendar markers, such as @#DJULIAN@ before a date, and the name the
# book prints after it: "14 March 1789 (Julian)". Gregorian is the default.
CALENDARS = {"GREGORIAN": "", "JULIAN": "Julian", "HEBREW": "Hebrew",
             "FRENCH R": "French Republican", "ROMAN": "Roman", "UNKNOWN": "calendar unknown"}
# Month names of the Hebrew and French Republican calendars, by GEDCOM code.
CALENDAR_MONTHS = {
    "Hebrew": {"TSH": "Tishrei", "CSH": "Cheshvan", "KSL": "Kislev", "TVT": "Tevet",
               "SHV": "Shevat", "ADR": "Adar", "ADS": "Adar II", "NSN": "Nisan", "IYR": "Iyar",
               "SVN": "Sivan", "TMZ": "Tammuz", "AAV": "Av", "ELL": "Elul"},
    "French Republican": {"VEND": "Vendémiaire", "BRUM": "Brumaire", "FRIM": "Frimaire",
                          "NIVO": "Nivôse", "PLUV": "Pluviôse", "VENT": "Ventôse",
                          "GERM": "Germinal", "FLOR": "Floréal", "PRAI": "Prairial",
                          "MESS": "Messidor", "THER": "Thermidor", "FRUC": "Fructidor",
                          "COMP": "jours complémentaires"},
}


def calendar(value):
    """A GEDCOM date without its calendar markers, and the calendar's name to
    print after it ("" for Gregorian): ("14 MAR 1789", "Julian")."""
    names = []

    def drop(match):
        code = match.group(1).strip()
        name = CALENDARS.get(code, code.title())
        if name and name not in names:
            names.append(name)
        return ""

    rest = re.sub(r"@#D([A-Z][A-Z ]*?)@\s*", drop, value or "").strip()
    for name in names:
        for code, month in CALENDAR_MONTHS.get(name, {}).items():
            rest = re.sub(rf"\b{code}\b", month, rest)
    return rest, " and ".join(names)


def edition_date(day):
    """The edition date as the book prints it, day first: "17 October 2026"."""
    return f"{day.day} {day:%B %Y}"


def date_year(value):
    """Reduce precision to a year, preserving uncertainty between years."""
    if not value:
        return ''
    value, named = calendar(value.strip())
    year = _date_year(value)
    return f"{year} ({named})" if named and year else year


def _date_year(value):
    years = re.findall(r'\d{4}(?:/\d{1,4})?', value)
    if not years or 'B.C.' in value:
        return value
    prefix = value.split()[0]
    qualifiers = {'ABT': 'c.', 'CAL': 'calc.', 'EST': 'est.',
                  'BEF': 'before', 'AFT': 'after'}
    if prefix in qualifiers and len(years) == 1:
        return qualifiers[prefix] + ' ' + years[0]
    exact_date = (r'(?:(?:\d{1,2} )?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) )?'
                  r'\d{4}(?:/\d{1,4})?')
    if prefix in {'BET', 'FROM'} and len(years) == 2:
        separator = 'AND' if prefix == 'BET' else 'TO'
        if not re.fullmatch(rf'{prefix} {exact_date} {separator} {exact_date}', value):
            return value
        # A day/month interval within one year is exact at year precision.
        # Full-date renderers retain the original interval and its limits.
        if years[0] == years[1]:
            return years[0]
        if prefix == 'BET':
            return 'between ' + ' and '.join(years)
        return 'from ' + ' to '.join(years)
    if prefix == 'FROM' and len(years) == 1:
        return 'from ' + years[0]
    if prefix == 'TO' and len(years) == 1:
        return 'to ' + years[0]
    # Interpreted dates and unsupported calendar expressions keep their text.
    if re.fullmatch(exact_date, value):
        return years[0]
    return value


def lifespan(person):
    birth, death = (date_year(person.get(k, '')) for k in ('birth_date', 'death_date'))
    if birth and death and re.fullmatch(r'\d{4}(?:/\d{1,4})?', birth) and re.fullmatch(r'\d{4}(?:/\d{1,4})?', death):
        return birth + '–' + death
    return '; '.join(part for part in (f'b. {birth}' if birth else '', f'd. {death}' if death else '') if part)


# ---------- GEDCOM loading ----------

def load_gedcom(path=SRC_GED):
    """Parse the SSOT GEDCOM. Returns (people, fams_dict, parser).

    people: list of dicts from enrich-gedcom.collect_individual_data
    Unresolved confidence errors fail here; preservation export retains them.
    fams:   dict xref -> {"husb": xref|None, "wife": xref|None,
                          "chil": [xref...], "marr_date": str, "marr_plac": str,
                          "divorces": [{"date", "place", "uses"}, ...]}
    A divorce's "uses" are (key, label) pairs; Tree.keys_for names them as one
    spouse's sources do.
    """
    from gedcom.parser import Parser  # noqa: deferred so import error is clear

    parser = Parser()
    parser.parse_file(str(path))
    people, fam_els = _enrich.collect_individual_data(parser)
    confidence_errors = [error for person in people
                         for error in person["confidence_errors"]]
    if confidence_errors:
        raise ValueError("Unresolved person confidence:\n" + "\n".join(confidence_errors))
    records = {e.get_pointer(): e for e in parser.get_root_child_elements() if e.get_pointer()}

    fams = {}
    for xref, el in fam_els.items():
        f = {"xref": xref, "husb": None, "wife": None, "chil": [],
             "marr_date": "", "marr_plac": "", "marr_recorded": False, "divorces": []}
        for c in el.get_child_elements():
            t = c.get_tag()
            v = (c.get_value() or "").strip()
            if t == "HUSB":
                f["husb"] = v
            elif t == "WIFE":
                f["wife"] = v
            elif t == "CHIL":
                f["chil"].append(v)
            elif t == "MARR":
                f["marr_recorded"] = v.upper() != "N"
                for sub in c.get_child_elements():
                    if sub.get_tag() == "DATE":
                        f["marr_date"] = (sub.get_value() or "").strip()
                    elif sub.get_tag() == "PLAC":
                        f["marr_plac"] = (sub.get_value() or "").strip()
            elif t == "DIV":
                divorce = {"date": _enrich.child_text(c, "DATE"),
                           "place": _enrich.child_text(c, "PLAC"), "uses": []}
                for sub in c.get_child_elements():
                    if sub.get_tag() == "SOUR":
                        cite = _enrich.native_citation(sub, records, fact="divorce", family=xref)
                        divorce["uses"].append((cite["key"], cite["label"]))
                f["divorces"].append(divorce)
        fams[xref] = f
    return people, fams, parser


class Tree:
    """Indexed view over the parsed GEDCOM + ahnentafel/line computations."""

    def __init__(self, path=SRC_GED):
        self.people, self.fams, self._parser = load_gedcom(path)
        self.by_xref = {p["xref"]: p for p in self.people}
        self.by_refn = {}
        dupes = []
        for p in self.people:
            r = p.get("refn")
            if not r:
                continue
            if r in self.by_refn:
                dupes.append(r)   # last-wins would silently drop an ancestor
            self.by_refn[r] = p
        if dupes:
            raise ValueError(
                f"duplicate REFN(s) in GEDCOM — a person would silently vanish "
                f"from coverage/register/index: {sorted(set(dupes))}")
        self.src_path = Path(path)

    # ----- relationships -----

    def parents_of(self, xref):
        """(father_xref|None, mother_xref|None) via FAMC."""
        p = self.by_xref.get(xref)
        if not p or not p.get("famc"):
            return None, None
        fam = self.fams.get(p["famc"])
        if not fam:
            return None, None
        return fam["husb"], fam["wife"]

    def spouse_families(self, xref):
        """Spouse FAMs, deduped — duplicate FAMS pointers exist in the wild
        and would otherwise print a marriage/children block twice."""
        p = self.by_xref.get(xref)
        out, seen = [], set()
        for f in (p.get("fams") or []):
            if f in self.fams and f not in seen:
                seen.add(f)
                out.append(self.fams[f])
        return out

    def children_of_family(self, fam):
        return [self.by_xref[c] for c in fam["chil"] if c in self.by_xref]

    @staticmethod
    def keys_for(person, uses):
        """Citation keys for (key, label) uses, as this person's sources name
        them. One person's two different uses of a source have their own keys."""
        renamed = person.get("renamed_keys", {})
        return [renamed.get(use, use[0]) for use in uses]

    # ----- ahnentafel -----

    def ahnentafel(self, root_refn):
        """Return OrderedDict n -> xref for every direct ancestor of root
        (root itself is n=1). Handles pedigree collapse: the same xref may
        appear under multiple n.
        """
        root = self.by_refn.get(root_refn)
        if not root:
            raise KeyError(f"root refn {root_refn!r} not found in GEDCOM")
        table = OrderedDict()
        # Each entry carries the people between it and the root, so a person
        # who is their own ancestor (a loop of FAMC links) is found however
        # many generations the tree has.
        stack = [(1, root["xref"], ())]
        while stack:
            n, xref, below = stack.pop()
            if xref in below:
                loop = [self.by_xref[x].get("refn") or x for x in below[below.index(xref):]]
                raise ValueError("the tree's parent links go round in a loop: "
                                 + " -> ".join(loop + [loop[0]])
                                 + ". Each person is recorded as an ancestor of themselves")
            table[n] = xref
            father, mother = self.parents_of(xref)
            path = below + (xref,)
            if father:
                stack.append((2 * n, father, path))
            if mother:
                stack.append((2 * n + 1, mother, path))
        return OrderedDict(sorted(table.items()))

    def register_people(self, root_refn):
        """The ids of everyone the register names: the ancestors, their
        partners, and the descendant families it continues (a partner's
        other family only for its children)."""
        numbered = set(self.ahnentafel(root_refn).values())
        pending = [(xref, False) for xref in numbered]
        included, expanded = set(numbered), set()
        while pending:
            xref, children_only = pending.pop()
            if (xref, children_only) in expanded:
                continue
            expanded.add((xref, children_only))
            for family in self.spouse_families(xref):
                if children_only and not family["chil"]:
                    continue
                for partner in (family["husb"], family["wife"]):
                    if partner in self.by_xref:
                        included.add(partner)
                        if partner != xref and partner not in numbered:
                            pending.append((partner, True))
                for child in family["chil"]:
                    if child in self.by_xref:
                        included.add(child)
                        pending.append((child, False))
        return {self.by_xref[xref]["refn"] for xref in included}

    @staticmethod
    def numbers_by_xref(table):
        """Invert ahnentafel: xref -> sorted [n, ...] (pedigree collapse aware)."""
        inv = {}
        for n, xref in table.items():
            inv.setdefault(xref, []).append(n)
        return {x: sorted(ns) for x, ns in inv.items()}

    @staticmethod
    def generation(n):
        """0 for root, 1 for parents, ..."""
        return n.bit_length() - 1

    # ----- line (surname lineage) computation -----

    def line_of(self, n, table):
        """Deterministic chapter-line id for ahnentafel number n.

        Rules:
        - n == 1 -> "origin"
        - male (n even): walk patriline upward (2n, 4n, ...) to the topmost
          male present in the table; his surname founds the line.
        - female (n odd): if her father (2n) is in the table, she belongs to
          his line; else to her husband's line (n-1).
        """
        if n == 1:
            return "origin"
        if n not in table:
            # reachable via the female fallback when her husband is also
            # unknown (mother-recorded, father-unknown FAM) — must not crash
            return "unknown"
        if n % 2 == 0:  # male
            top = n
            while (2 * top) in table:
                top = 2 * top
            surname = self.by_xref[table[top]].get("surname")
            # Two unrelated lines can share a surname (two founders both
            # called Grey). The line founded nearest the root keeps the plain name;
            # each other one is named for its founder, so it can be mapped to
            # its own chapter.
            if top != self._first_founders(table)[line_slug(surname)]:
                return line_slug(surname) + "-" + self.by_xref[table[top]]["refn"]
            return line_slug(surname)
        # female: father's line if known; else husband's; else her own surname
        if (2 * n) in table:
            return self.line_of(2 * n, table)
        if (n - 1) in table:
            return self.line_of(n - 1, table)
        return line_slug(self.by_xref[table[n]].get("surname"))

    def _first_founders(self, table):
        """For each line's surname id, the number of the founder nearest the
        root. Found once per table: a deep tree asks for it thousands of times."""
        if getattr(self, "_founders_table", None) is not table:
            first = {}
            for m in sorted(table):
                if m % 2 == 0 and (2 * m) not in table:
                    first.setdefault(line_slug(self.by_xref[table[m]].get("surname")), m)
            self._founders_table, self._founders = table, first
        return self._founders

    # ----- staleness hash -----

    def person_hash(self, refn):
        """sha256[:12] over INDI, related FAMs, and referenced source records,
        whitespace-normalized, from the SSOT text.
        """
        p = self.by_refn.get(refn)
        if not p:
            return None
        xref = p["xref"]
        want = {xref}
        for fx, f in self.fams.items():
            if xref in (f["husb"], f["wife"]) or xref in f["chil"]:
                want.add(fx)
        # Include shared source/media/repository/note records used by these
        # individual/family blocks. Changing a source must stale its users,
        # without following family links out through the entire pedigree.
        raw_blocks = re.split(r"(?=^0 )", self.src_path.read_text(encoding="utf-8"), flags=re.M)
        records = {}
        for block in raw_blocks:
            match = re.match(r"0 (@[^@]+@) (\w+)", block)
            if match:
                records[match.group(1)] = (match.group(2), block)
        pending = list(want)
        while pending:
            pointer = pending.pop()
            if pointer not in records:
                continue
            for dependency in re.findall(r"^\d+ (?:SOUR|REPO|NOTE|OBJE) (@[^@]+@)",
                                         records[pointer][1], flags=re.M):
                if (dependency in records and dependency not in want
                        and records[dependency][0] in {"SOUR", "REPO", "NOTE", "OBJE"}):
                    want.add(dependency)
                    pending.append(dependency)
        blocks = [records[pointer][1] for pointer in want if pointer in records]
        blob = "\n".join(sorted(re.sub(r"\s+", " ", block).strip() for block in blocks))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]

    # ----- sources -----

    def sources_by_person(self, refns=None):
        """refn -> OrderedDict slug -> {"label", "url", "tier"}.

        Citation keys are namespaced PER PERSON (a sketch resolves markers
        against the union of its covered persons' sources), so slugs only
        need uniqueness within one person's source list. Legacy collisions use
        content hashes; native citations use stable _KEYs or source IDs.
        Ambiguous native keys fail instead of silently selecting a citation.
        """
        out = OrderedDict()
        for p in self.people:
            refn = p.get("refn")
            if not refn or (refns is not None and refn not in refns):
                continue
            # two-pass, content-derived keys: when two DIFFERENT labels share a
            # truncated slug, both get a suffix derived from their own label
            # text (sha1[:4]) — stable under reordering/insertion of sources,
            # unlike order-dependent -2/-3 numbering.
            srcs = p.get("sources") or []
            base_count = {}
            for s in srcs:
                if not s.get("native"):
                    base_count.setdefault(slugify(s["label"]), set()).add(s["label"])
            slugs = OrderedDict()
            for s in srcs:
                base = slugify(s["label"])
                if s.get("native"):
                    key = s["key"]
                elif len(base_count[base]) > 1:
                    key = (slugify(s["label"], 42) + "-"
                           + hashlib.sha1(s["label"].encode("utf-8")).hexdigest()[:4])
                else:
                    key = base
                if key not in slugs:
                    slugs[key] = {
                        "label": s["label"],
                        "source_label": s.get("source_label", s["label"]),
                        "url": s.get("url", ""),
                        "tier": s.get("tier") or classify_source(classification_text(s)),
                        "native": bool(s.get("native")), "short": s.get("short"),
                        "source_id": s.get("source_id"),
                        "facts": [], "paths": [], "raw_notes": [], "uses": [],
                    }
                elif (slugs[key]["label"] != s["label"]
                      or slugs[key]["source_id"] != s.get("source_id")
                      or slugs[key]["url"] != s.get("url", "")):
                    raise ValueError(f"ambiguous citation key {key!r} for {refn}; "
                                     "use distinct citation _KEY values for different locators/assessments")
                for fact in s.get("facts", []):
                    if fact not in slugs[key]["facts"]:
                        slugs[key]["facts"].append(fact)
                for field in ("paths", "raw_notes"):
                    slugs[key][field] = sorted(set(slugs[key][field] + s.get(field, [])))
                use = {k: s.get(k) for k in ("page", "quay", "facts") if s.get(k)}
                if use and use not in slugs[key]["uses"]:
                    slugs[key]["uses"].append(use)
            out[refn] = slugs
        return out

    def all_sources(self):
        """label -> {"label", "urls", "tier", "people"} across the whole tree
        (for the generated bibliography)."""
        out = OrderedDict()
        for p in self.people:
            for s in p.get("sources") or []:
                label = s.get("source_label", s["label"])
                rec = out.get(label)
                if rec is None:
                    rec = out[label] = {
                        "label": label,
                        "urls": set(),
                        "tier": s.get("tier") or classify_source(classification_text(s)),
                        "people": [],
                    }
                if s.get("url"):
                    rec["urls"].add(s["url"])
                if p.get("refn") and p["refn"] not in rec["people"]:
                    rec["people"].append(p["refn"])
        return out


class Stop(ValueError):
    """A problem the family can fix. The build prints it without a traceback."""


# ---------- an ancestor reached by more than one line ----------

def repeated_ancestors_once():
    """book.repeated_ancestors: "once" (the default) prints an ancestor reached
    by several lines, and their own ancestors, under their first number only;
    later numbers say "see no. N". "every_line" repeats them under each."""
    value = flyleaf_settings.get("book.repeated_ancestors", "once")
    if value not in ("once", "every_line"):
        raise SystemExit('flyleaf.json: book.repeated_ancestors is "once" or "every_line"')
    return value == "once"


def first_appearances(table):
    """Pedigree collapse. From an ahnentafel table (n -> xref), the numbers to
    print, and for each later number of a repeated ancestor the number they
    first appear under. A number prints when the child it descends from
    prints and is not itself a repeat, or is not in the table at all."""
    first, shown, repeats = {}, OrderedDict(), {}
    for n, xref in sorted(table.items()):
        first.setdefault(xref, n)
        if n == 1 or n // 2 not in table or (n // 2 in shown and n // 2 not in repeats):
            shown[n] = xref
            if first[xref] != n:
                repeats[n] = first[xref]
    return shown, repeats


# ---------- people who may be living ----------

BIRTH_EVENTS = {"BIRT", "CHR", "BAPM"}
DEATH_EVENTS = {"DEAT", "BURI", "CREM", "PROB"}
ASSERTING = {"DATE", "PLAC", "SOUR", "AGE", "CAUS", "ADDR"}
LIFESPAN, GENERATION = 100, 30  # years, as in website/app/lib/branches.ts


def possibly_living(tree, this_year=None):
    """The xrefs of people who may still be alive, by the usual genealogy rule.

    A person with no death, burial, cremation or probate record may be living
    when they were born or christened in the last 100 years. A record counts
    when its date, place or source holds something, or it reads "Y" (1 DEAT Y);
    one with only a note, or an empty date, does not. A birth "between 1900
    and 1980" counts by its latest year. A date with no end, such as "after
    1900", does not count, since it does not say how late. Without a birth
    date, the latest of their dated facts (a marriage, a census) counts.
    Without any date, their year is estimated from their nearest dated
    relatives: 30 years after a parent's, a partner's own, or 30 years before
    a child's, as the website does (website/app/lib/branches.ts). Someone
    with no date to go on at all may be living.
    """
    import build_clock
    this_year = this_year or build_clock.today().year
    records = {e.get_pointer(): e for e in tree._parser.get_element_list()
               if e.get_level() == 0 and e.get_pointer()}

    def years(event):
        # CHAN and CREA date the record's last edit, not a fact of a life.
        if event.get_tag() in {"CHAN", "CREA"}:
            return []
        dates = [c.get_value() or "" for c in event.get_child_elements() if c.get_tag() == "DATE"]
        date = (dates[0] if dates else "").upper()
        # "AFT 1900" or "FROM 1900" with no end says nothing about how late.
        if re.match(r"\s*AFT\b", date) or ("FROM" in date and " TO " not in date):
            return []
        return [int(y) for y in re.findall(r"\b(\d{3,4})\b", date)]

    def asserted(event):
        # GEDCOM: a date or place says the event happened, and so does "Y".
        return ((event.get_value() or "").strip().upper() == "Y"
                or any(c.get_tag() in ASSERTING and (c.get_value() or "").strip()
                       for c in event.get_child_elements()))

    year, dead = {}, set()
    for xref in tree.by_xref:
        facts = records[xref].get_child_elements()
        if any(fact.get_tag() in DEATH_EVENTS and asserted(fact) for fact in facts):
            dead.add(xref)
        births = [y for fact in facts if fact.get_tag() in BIRTH_EVENTS for y in years(fact)]
        dated = [y for fact in facts for y in years(fact)]
        for fid in (c.get_value() for c in facts if c.get_tag() == "FAMS"):
            if fid in records:
                dated += [y for fact in records[fid].get_child_elements() for y in years(fact)]
        if births or dated:
            year[xref] = max(births or dated)
    # (relative, years to add) for each person: parents, partners, children.
    steps = {xref: [] for xref in tree.by_xref}
    for family in tree.fams.values():
        couple = [x for x in (family["husb"], family["wife"]) if x in steps]
        kids = [x for x in family["chil"] if x in steps]
        for a in couple:
            steps[a] += [(b, 0) for b in couple if b != a] + [(k, -GENERATION) for k in kids]
        for k in kids:
            steps[k] += [(a, GENERATION) for a in couple]
    # In rounds, nearest relatives first: each round reads only years known
    # before it began, so the order of people in the file never matters.
    while True:
        found = {xref: max(year[r] + add for r, add in steps[xref] if r in year)
                 for xref in tree.by_xref
                 if xref not in year and any(r in year for r, _ in steps[xref])}
        if not found:
            break
        year.update(found)
    return {xref for xref in tree.by_xref if xref not in dead
            and (xref not in year or year[xref] >= this_year - LIFESPAN)}


# ---------- helpers ----------

def classification_text(source):
    """What a source is classified by, as validate-gedcom.py classifies it:
    a source record's title and addresses; a [Source] note's label and link."""
    return source.get("classify") or source_tiers.source_text(source["label"], [source.get("url")])


def slugify(text, max_len=48):
    """Deterministic ascii slug of a source label. Stories cite a [Source]
    note by this key, so its form never changes."""
    t = text.lower()
    t = re.sub(r"https?://\S+", "", t)          # drop URLs
    t = re.sub(r"[’'\"“”‘]", "", t)
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:max_len].rstrip("-") or "x"


def line_slug(surname):
    """A family line's id, from its founder's surname, in any alphabet:
    "Müller" is the line muller (see ascii_ids)."""
    return ascii_ids.slug(surname or "unknown") or "x"


def root_refn(cfg):
    """The book's root person (book.yaml `root_refn`), ahnentafel number 1."""
    root = cfg.get("root_refn")
    if not root:
        raise SystemExit(f"{BOOK_YAML.relative_to(ROOT).as_posix()} needs root_refn: "
                         "the person the book is about. Run flyleaf import with your tree, "
                         "--replace and --root 'Their Name' to set it and plan the chapters.")
    return root


# The two sides of the family a chapter's other_lines can name: the
# ancestors of the root's father (no. 2) and of the root's mother (no. 3).
SIDES = {"father": 2, "mother": 3}


def side_of(n):
    """2 for the father's side, 3 for the mother's side, 1 for the root."""
    while n > 3:
        n //= 2
    return n


def resolve_chapters(cfg, tree, table=None):
    """book.yaml with every chapter's lines written out. A chapter with
    `other_lines: father` (or mother) also takes each line on that side of
    the family that no chapter lists, so a deep tree's plan can name its
    nearer lines and leave the rest to one chapter. `table` is the root's
    ahnentafel, worked out here when it is needed and not given."""
    takers = {}
    for chapter in cfg["chapters"]:
        side = chapter.get("other_lines")
        if side is None:
            continue
        if side not in SIDES:
            raise ValueError(f"book.yaml: chapter {chapter.get('id')!r} has other_lines: {side}; "
                             "use father or mother")
        if SIDES[side] in takers:
            raise ValueError(f"book.yaml: two chapters take the other lines on the {side}'s side")
        takers[SIDES[side]] = chapter
    if not takers:
        return cfg
    table = table if table is not None else tree.ahnentafel(root_refn(cfg))
    named = {line for chapter in cfg["chapters"] for line in chapter.get("lines", [])}
    extra = {chapter.get("id"): [] for chapter in takers.values()}
    for n in table:
        line = tree.line_of(n, table)
        chapter = takers.get(side_of(n))
        if chapter and line not in named and line not in extra[chapter.get("id")]:
            extra[chapter.get("id")].append(line)
    return dict(cfg, chapters=[dict(c, lines=[*c.get("lines", []), *extra.get(c.get("id"), [])])
                               for c in cfg["chapters"]])


def strapline(cfg):
    """The small line above the title (book.yaml strapline). A book claims to
    be documented only when its editor says so."""
    return str(cfg.get("strapline") or "A Family History")


def load_book_yaml(path=BOOK_YAML):
    """Minimal YAML subset reader for book.yaml (no external deps).

    Supports: `key: value` scalars, `chapters:` list of
    `- {id: x, title: "...", lines: [a, b]}` flow mappings.
    """
    cfg = {"chapters": []}
    text = Path(path).read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        m = re.match(r"^- \{(.*)\}\s*$", line.strip())
        if m:
            item = {}
            body = m.group(1)
            # split top-level commas not inside [...] or "..."
            parts, depth, in_q, cur = [], 0, False, ""
            for ch in body:
                if ch == '"':
                    in_q = not in_q
                elif not in_q:
                    if ch == "[":
                        depth += 1
                    elif ch == "]":
                        depth -= 1
                if ch == "," and depth == 0 and not in_q:
                    parts.append(cur)
                    cur = ""
                else:
                    cur += ch
            if cur.strip():
                parts.append(cur)
            for part in parts:
                k, v = part.split(":", 1)
                k, v = k.strip(), v.strip()
                if v.startswith("["):
                    item[k] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
                else:
                    item[k] = v.strip("'\"")
            cfg["chapters"].append(item)
        elif ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            v = v.strip().strip("'\"")
            if v:
                cfg[k.strip()] = v
    return cfg


# ---------- page size ----------

# The template's margins. The text column, and so the family charts, is the
# page width less the inside and outside margins.
MARGINS_IN = {"inside": 0.95, "outside": 0.7, "top": 0.8, "bottom": 0.85}
DEFAULT_TRIM = {"trim_width": "6in", "trim_height": "9in"}
_POINTS = {"in": 72.0, "mm": 72 / 25.4, "cm": 72 / 2.54, "pt": 1.0}
# Below a chart or a tall picture: room for its caption and a few lines of text.
_CAPTION_ROOM_PT = 133.2


def page_settings(cfg=None):
    """The page size from book.yaml (trim_width, trim_height; default 6 by 9
    inches), and what the margins leave of it, in points."""
    if cfg is None:
        cfg = load_book_yaml() if BOOK_YAML.is_file() else {}
    sizes = {}
    for key, default in DEFAULT_TRIM.items():
        value = cfg.get(key) or default
        m = re.fullmatch(r"(\d+(?:\.\d+)?)(in|mm|cm|pt)", value.replace(" ", ""))
        if not m:
            raise SystemExit(f"book.yaml: {key} must be a length such as 6in or 152mm, "
                             f"not {value!r}")
        sizes[key] = (m[1] + m[2], float(m[1]) * _POINTS[m[2]])
    sides = (MARGINS_IN["inside"] + MARGINS_IN["outside"]) * 72
    ends = (MARGINS_IN["top"] + MARGINS_IN["bottom"]) * 72
    text_width = round(sizes["trim_width"][1] - sides, 4)
    text_height = round(sizes["trim_height"][1] - ends, 4)
    if text_width < 2 * 72 or text_height - _CAPTION_ROOM_PT < 2 * 72:
        raise SystemExit("book.yaml: the trim size leaves too little room for the text")
    return {"width": sizes["trim_width"][0], "height": sizes["trim_height"][0],
            "text_width_pt": text_width, "text_height_pt": text_height,
            "figure_height_pt": round(text_height - _CAPTION_ROOM_PT, 4)}


def page_module(cfg=None):
    """The Typst module the template imports for the page size."""
    page = page_settings(cfg)
    points = lambda value: f"{value:.4f}".rstrip("0").rstrip(".") + "pt"
    margins = ", ".join(f"{side}: {inches}in" for side, inches in MARGINS_IN.items())
    return ("// Generated from book.yaml (trim_width, trim_height). Do not edit.\n"
            f"#let page-width = {page['width']}\n#let page-height = {page['height']}\n"
            f"#let margins = ({margins})\n"
            f"#let chart-width = {points(page['text_width_pt'])}\n"
            f"#let tall-figure-height = {points(page['figure_height_pt'])}\n")


def citation_scope(meta, covers, tree):
    """Validate explicit sketch citation owners without changing coverage.

    ``covers`` assigns direct ancestors to a narrative. ``citation_people``
    adds named owners of sources for collateral accounts in that narrative;
    it does not establish relationships or confer ancestor/register coverage.
    """
    extra = meta.get("citation_people", [])
    if not isinstance(extra, list):
        raise ValueError("citation_people must be a list of existing person REFNs")
    seen = set(covers)
    for refn in extra:
        if not isinstance(refn, str) or not refn or refn not in tree.by_refn:
            raise ValueError(f"citation_people contains unknown person REFN {refn!r}")
        if refn in seen:
            raise ValueError(f"citation_people repeats covered or declared person {refn!r}")
        seen.add(refn)
    return list(covers) + extra


def resolve_source(source_map, refns, key):
    """Resolve exactly the allowed people; never borrow a source out of scope.

    Identical references on multiple people are a shared source. Distinct
    references with the same authoring key require person qualification.
    """
    if "::" in key:
        person, key = key.split("::", 1)
        refns = [person] if person in refns else []
    matches = [(r, source_map.get(r, {}).get(key)) for r in dict.fromkeys(refns)]
    matches = [(r, s) for r, s in matches if s is not None]
    identities = {(s["label"], s.get("url", ""), s.get("source_id")) for _, s in matches}
    if len(identities) > 1:
        raise ValueError(f"ambiguous citation {key!r} across "
                         f"{[r for r, _ in matches]}; use person-refn::key")
    return matches[0] if matches else None


def figure_path(name, root=ROOT):
    """The same author shorthand paths used by assembly and claim review."""
    root = Path(root)
    return next((p for p in (root / "build/figures" / f"{name}.svg",
                             root / "build/figures" / f"{name}.png",
                             root / flyleaf_settings.folder_name("images") / name)
                 if p.is_file()), None)


def parse_front_matter(path):
    """Read a sketch file. Returns (meta_dict, body_str).

    Two front-matter styles:
      Markdown files: YAML between `---` fences.
      Typst files (.typ): YAML inside `//`-comment lines between `// ---` fences:
          // ---
          // refn: john-penhallow
          // covers: [john-penhallow, elizabeth-trembath]
          // ---
    Values: `key: value` scalars and `key: [a, b]` lists only.
    """
    text = Path(path).read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        m = re.match(r"^// ---\n(.*?)\n// ---\n?(.*)$", text, re.S)
        if m:
            yaml_body = "\n".join(re.sub(r"^// ?", "", l) for l in m.group(1).splitlines())
            m = type("M", (), {"group": lambda self, i, a=yaml_body, b=m.group(2): a if i == 1 else b})()
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        line = line.split("#", 1)[0].rstrip()
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        # Do not turn a malformed new scope declaration into a shorter,
        # apparently valid list. The shared scope validator reports it.
        if k == "citation_people" and not (v.startswith("[") and v.endswith("]")):
            meta[k] = v
        elif v.startswith("["):
            items = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
            meta[k] = items
        else:
            meta[k] = v.strip("'\"")
    return meta, m.group(2)


if __name__ == "__main__":
    # Smoke test: print the ahnentafel + computed lines for the configured root.
    tree = Tree()
    root = root_refn(load_book_yaml())
    table = tree.ahnentafel(root)
    print(f"root={root}  ancestors(incl. root)={len(table)}")
    for n, xref in table.items():
        p = tree.by_xref[xref]
        line = tree.line_of(n, table)
        print(f"  {n:>4}  g{tree.generation(n)}  {line:<10} {p['refn'] or '(no refn)':<28} "
              f"{(p['given'] or '')} {(p['surname'] or '')}")
