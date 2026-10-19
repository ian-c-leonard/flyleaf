#!/usr/bin/env python3
"""MECE coverage + staleness checker for the family-history book.

Reconciles two corpora:
  1. The source GEDCOM (paths.source_gedcom) — every direct ancestor of the
     book root (book/book.yaml `root_refn`)
  2. The narrative sections (book/sketches/*.typ front matter)

Every ancestor must be `covers`-claimed by EXACTLY ONE narrative section
(Part II of the book — the generated register — is complete by construction).

States:
  ok (final/draft)  sketch exists, prose current            -> ok
  stub              scaffolded, no prose yet                -> warn
  missing           ancestor with no section claiming them  -> warn
  stale             GEDCOM changed since prose last revised -> warn
  orphaned          section refn not in GEDCOM / not an ancestor   -> ERROR
  duplicate         two sections claim the same person             -> ERROR
  mismatch          front-matter ahnentafel/line disagree w/ computed -> ERROR
  unmapped-line     computed line missing from book.yaml chapters     -> ERROR
  slug-collision    two source labels slugify identically             -> ERROR

Writes book/COVERAGE.md (committed gap dashboard). Exit non-zero on errors
(always) and on warnings with --strict.

Usage:
  book-coverage.py [--strict] [--mark-current REFN | --mark-current-all] [--quiet]
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import booklib  # noqa: E402
import build_clock  # noqa: E402
import flyleaf_settings  # noqa: E402

COVERAGE_MD = booklib.BOOK_DIR / "COVERAGE.md"
REGION_NAMES = flyleaf_settings.get("places.region_names", [])


# A year a record can give: four digits, from 1000 to the year of the build.
# A house number, as in "1412 Elm Street", is not a year.
_FOUR_DIGITS = re.compile(
    r"\b([12]\d{3})\b(?!\s+(?:[A-Z][\w'.-]*\s+){0,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|"
    r"Boulevard|Blvd|Drive|Place|Court|Terrace|Square|Way)\b)")


def years_in(text):
    """The years in text, from 1000 to this year: a later number is not a date."""
    return [y for y in _FOUR_DIGITS.findall(text or "")
            if 1000 <= int(y) <= build_clock.today().year]


CITE_RE = re.compile(r'#src\("[a-z0-9-]+(?:::[a-z0-9-]+)?"\)')

US_POSTAL = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA "
             "MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN "
             "TX UT VT VA WA WV WI WY").split()

# Style rules from the NEHGS Guide that are regex-detectable in authored prose
# (see docs/book.md; the same `// cite-lint: ok <reason>` comment suppresses
# every rule for the paragraph beneath it).
PROSE_RULES = [
    ("L4", re.compile(r"\b(?:January|February|March|April|May|June|July|August|"
                      r"September|October|November|December) \d{1,2}, \d{4}\b"),
     "US month-day-year date (day-month-year — '23 May 1951')", "warn"),
    ("L5", re.compile(r"\b\d{1,2}(?:st|nd|rd|th)\b"),
     "ordinal numeral ('May 23' not '23rd'; spell out centuries)", "warn"),
    ("L7", re.compile(r", (?:Jr|Sr|II|III|IV)\b"),
     "comma before Jr./Sr./III (none, unless the person used one)", "warn"),
    ("L8", re.compile(r"\bibid\b", re.IGNORECASE),
     "ibid. (genealogical notes never use it — short titles instead)", "warn"),
    ("L9", re.compile(r"https?://"),
     "raw URL in prose (cite through #src; links live in footnotes)", "warn"),
    ("L10", re.compile(r"\b(?:I am|I'm|I was|I have|I found|my own|\bmy\b)\b"),
     "first-person singular (third person; editorial 'we' sparingly)", "warn"),
    ("L11", re.compile(r"\b(?:" + "|".join(US_POSTAL) + r")\b"),
     "two-letter state code such as CA: spell out the state, or use NEHGS abbreviations in child lines", "warn"),
    # With no regions set (places.region_names), the rule has nothing to check.
    ("L12", re.compile((r"\bat (?:" + "|".join(
        re.escape(name) + ("(?! City)" if name == "New York" else "")
        for name in REGION_NAMES) + r")\b") if REGION_NAMES else r"(?!)"),
     "'at' before a region ('at' towns, 'in' regions)", "warn"),
    ("L13", re.compile(r"\b\d{1,2} (?:children|sons|daughters|siblings|"
                       r"grandchildren|generations|families|miles)\b"),
     "small count as a numeral (spell out through ninety-nine)", "warn"),
    ("L14", re.compile(r"[\"“][^\"“”]{280,}[\"”]"),
     "quotation over ~5 typeset lines (set as an indented extract)", "info"),
    # anti-bootstrapping (a later claim presented as confirming itself):
    # certainty language demands either a primary record or a rewrite
    ("L15", re.compile(r"\b(?:a fact confirmed|confirmed fact|it is certain|"
                       r"certainly|undoubtedly|unquestionabl\w+|beyond (?:all )?doubt|"
                       r"definitively|proves? beyond|established fact)\b", re.IGNORECASE),
     "certainty language — GPS check: is this proven by a primary record, or inferred?", "warn"),
]


def person_year_set(tree, refns):
    """Every year attested anywhere in the covered persons' GEDCOM records:
    structured dates of themselves, spouses, children, and parents, plus any
    year mentioned in their bio/notes/source labels. A prose year outside
    this set was invented, imported from the wrong person, or mistyped."""
    years = set()
    seen_x = set()
    for refn in refns:
        p = tree.by_refn.get(refn)
        if not p:
            continue
        related = [p]
        for fam in tree.spouse_families(p["xref"]):
            for x in (fam["husb"], fam["wife"], *fam["chil"]):
                if x and x in tree.by_xref and x not in seen_x:
                    related.append(tree.by_xref[x])
                    seen_x.add(x)
            for d in (fam.get("marr_date"),):
                years.update(years_in(d))
        f_x, m_x = tree.parents_of(p["xref"])
        for x in (f_x, m_x):
            if x and x in tree.by_xref:
                related.append(tree.by_xref[x])
        for r in related:
            for event in [*r.get("births", []), *r.get("deaths", []), *r.get("baptisms", []),
                          *r.get("christenings", []), *r.get("burials", []), *r.get("cremations", [])]:
                years.update(years_in(event["date"]))
            for field in ("birth_date", "death_date", "bio", "notes"):
                years.update(years_in(r.get(field)))
            for s in r.get("sources") or []:
                years.update(years_in(s.get("label")))
    return years


def lint_section(tree, sec, extra_years=None):
    """Citation lint for one narrative section. Returns list of findings.

    Rules (see docs/book.md):
      L1 paragraph >90 words with zero citations           -> warn
      L2 sentence containing a year but no citation        -> warn
      L3 year absent from declared persons' GEDCOM records -> warn (fact-check)
    Suppression: a line `// cite-lint: ok <reason>` immediately above a
    paragraph suppresses L1/L2 for it (the reason is the editorial record).
    Front-matter `context_years: [1692, …]` extends the L3 allowlist for
    historical-context years.
    """
    findings = []
    meta, body = booklib.parse_front_matter(sec["path"])
    covers = sec["covers"]
    scope = booklib.citation_scope(meta, covers, tree)
    allowed = person_year_set(tree, scope)
    for y in (meta.get("context_years") or []):
        allowed.add(str(y))
    if extra_years:
        allowed.update(extra_years)

    name = sec["path"].name
    # Build (suppressed?, content) chunks. A `// cite-lint: ok` comment —
    # whether attached to its paragraph or on the chunk above — waives the
    # STYLE rules (L1/L2/L4+) for EXACTLY ONE following content paragraph.
    # It never hides a paragraph from linting entirely, and L3 (the
    # fact-checker) ALWAYS runs, suppressed or not.
    chunks = []
    pending_ok = False
    for raw_para in body.split("\n\n"):
        para = raw_para.strip()
        if not para:
            continue
        lines = para.splitlines()
        comment_lines = [l for l in lines if l.strip().startswith("//")]
        content_lines = [l for l in lines if not l.strip().startswith("//")]
        has_ok = any("cite-lint: ok" in l for l in comment_lines)
        content = "\n".join(content_lines).strip()
        if not content:
            pending_ok = pending_ok or has_ok
            continue
        chunks.append((pending_ok or has_ok, content))
        pending_ok = False

    for suppress, para in chunks:
        words = len(para.split())
        cites = len(CITE_RE.findall(para))
        if not suppress and words > 90 and cites == 0:
            findings.append(f"{name}: L1 uncited paragraph ({words} words): "
                            f"“{para[:60]}…”")
        if not suppress:
            # mask initials ("J. Smith") and common abbreviations so they
            # don't false-split sentences
            masked = re.sub(r"\b([A-Z])\.", r"\1․", para)
            masked = re.sub(r"\b(no|ca|bef|aft|St|Co|Jr|Sr|Dr|Rev|Mr|Mrs)\.",
                            r"\1․", masked)
            for sent in re.split(r"(?<=[.!?])\s+", masked):
                if years_in(sent) and not CITE_RE.search(sent):
                    findings.append(f"{name}: L2 dated sentence without citation: "
                                    f"“{sent.replace(chr(0x2024), '.').strip()[:70]}…”")
        for y in years_in(para):
            if y not in allowed:
                findings.append(f"{name}: L3 year {y} not found in the GEDCOM records "
                                f"of {covers} — invented, wrong person, or typo?")
        if not suppress:
            # citation calls are syntax, not prose; verbatim quotes follow the
            # record they transcribe, not the style guide (Guide ch. 6) — mask
            # both before style rules. L14 (long quotes) sees the unmasked text.
            clean = CITE_RE.sub(" ", para)
            clean_noq = re.sub(r'["“][^"“”]*["”]', " ", clean)
            for rid, rx, msg, sev in PROSE_RULES:
                target = clean if rid == "L14" else clean_noq
                m = rx.search(target)
                if m:
                    findings.append(f"{name}: {rid} {msg}: "
                                    f"“…{target[max(0, m.start()-25):m.end()+25].strip()}…”")
            # L16 — name drift: a capitalized word one edit away from a
            # person's name in the GEDCOM, appearing NOWHERE in the GEDCOM
            # itself (same evidence base L3 uses for years), is the
            # documented LLM failure where names revert to statistically
            # probable spellings ("Bridgit" -> "Bridget"). Same-first-letter,
            # length >= 5, distance == 1.
            name_toks, all_toks = tree_name_tokens(tree)
            for w in set(re.findall(r"\b[A-Z][a-z]{4,}\b", clean_noq)):
                if w.lower() in all_toks:
                    continue
                near = next((t for t in name_toks
                             if len(t) >= 5 and t[0] == w[0]
                             and abs(len(t) - len(w)) <= 1
                             and edit_distance_le1(w, t)), None)
                if near:
                    findings.append(
                        f"{name}: L16 possible name drift: “{w}” is one edit from "
                        f"“{near}” in the GEDCOM but appears nowhere in it — "
                        f"typo or spelling reverting to the common form?")
    return findings


def tree_name_tokens(tree):
    """(name tokens of every person, lowercase alpha tokens of the entire
    src GEDCOM) — memoized on the tree object. The full-text set plays the
    same role for L16 that person_year_set plays for L3: what the GEDCOM
    itself records is admissible."""
    cached = getattr(tree, "_name_tokens", None)
    if cached is None:
        names = set()
        for p in tree.by_xref.values():
            for field in (p.get("given"), p.get("surname")):
                names.update(re.findall(r"[A-Za-z]+", field or ""))
        text = tree.src_path.read_text(encoding="utf-8")
        alltok = {t.lower() for t in re.findall(r"[A-Za-z]+", text)}
        cached = (names, alltok)
        tree._name_tokens = cached
    return cached


def edit_distance_le1(a, b):
    """True iff levenshtein(a, b) <= 1 (a != b callers guaranteed)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = j = diffs = 0
    while i < la and j < lb:
        if a[i] != b[j]:
            diffs += 1
            if diffs > 1:
                return False
            if la == lb:
                i += 1
            j += 1
        else:
            i += 1
            j += 1
    return True


def lint_gedcom_sources(tree, ancestors):
    """G4 — citation permanence for the book persons' sources.

    FamilySearch states that ARK URLs are the ONLY supported link format;
    every other FamilySearch URL "could change at any given time"
    (developers.familysearch.org). Evidence Explained found >68% of its own
    cited URLs dead within nine years. Record-image links without an ARK
    will rot out from under the citation.
    """
    findings = []
    fs_record = re.compile(r"familysearch\.org/(?:search|records)\b", re.I)
    srcs = tree.sources_by_person()
    seen = set()
    for refn in ancestors:
        for rec in (srcs.get(refn) or {}).values():
            url = rec.get("url") or ""
            if url in seen:
                continue
            if fs_record.search(url) and "ark:" not in url:
                seen.add(url)
                findings.append(
                    f"G4 impermanent FamilySearch link ({refn}): {url} — "
                    f"replace with the record's ARK URL (the only link format "
                    f"FamilySearch supports) in the source GEDCOM")
    return findings


def lint_gedcom_places(tree, ancestors):
    """Data-side lint over the book persons' GEDCOM place/date fields.

    G1 — place fields containing two-letter state codes such as IN (Guide,
         Manual: spell states out; the register prints places as written, so
         the fix belongs in the source GEDCOM: 'Shelby Co., IN' -> 'Shelby
         County, Indiana').
    G2 — dates between 1 Jan and 24 Mar before 1752 lacking double-dating
         ('2 March 1714/5').
    """
    findings = []
    postal_rx = re.compile(r"(?:^|, )(" + "|".join(US_POSTAL) + r")(?:,|$| )")
    dd_rx = re.compile(r"\b(\d{1,2}) (JAN|FEB|MAR) (1[0-6]\d\d|17[0-4]\d|175[01])\b")
    seen = set()
    for refn, a in ancestors.items():
        p = tree.by_refn.get(refn)
        if not p:
            continue
        places = [p.get("birth_place"), p.get("death_place")]
        dates = [p.get("birth_date"), p.get("death_date")]
        for fam in tree.spouse_families(p["xref"]):
            if fam["husb"] == p["xref"]:
                places.append(fam.get("marr_plac"))
                dates.append(fam.get("marr_date"))
        for plc in places:
            if plc and plc not in seen and postal_rx.search(plc):
                seen.add(plc)
                findings.append(f"G1 two-letter state code in a place ({refn}): “{plc}”. "
                                f"Spell out the state name in the source GEDCOM")
        for plc in places:
            # G3: commentary does not belong in a place field (it prints
            # verbatim into the register). Two sanctioned parentheticals:
            # the "(now X)" historic-name gloss and the trailing
            # "(likely)"-style uncertainty qualifier, which book-assemble
            # renders Register-style as "probably at/in Place".
            if (plc and plc not in seen and "(" in plc
                    and not re.search(r"\(now [^)]+\)", plc)
                    and not re.search(r"\((likely|probably|possibly|perhaps)\)\s*$",
                                      plc, re.I)):
                seen.add(plc)
                findings.append(f"G3 commentary in GEDCOM place field ({refn}): “{plc}” "
                                f"— move the parenthetical to a NOTE in the source GEDCOM")
        for d in dates:
            if not d or "/" in d:
                continue
            m = dd_rx.search(d)
            if m and not (m.group(2) == "MAR" and int(m.group(1)) > 24):
                findings.append(f"G2 pre-1752 Jan–Mar date without double-dating "
                                f"({refn}): “{d}” — Guide: '2 March 1714/5'. Only for a record "
                                "kept in England, Wales, Ireland or a British colony")
    return findings


def gather(tree, cfg):
    """Compute everything the report needs. Returns dict."""
    root = booklib.root_refn(cfg)
    table = tree.ahnentafel(root)
    nums = tree.numbers_by_xref(table)
    try:
        cfg = booklib.resolve_chapters(cfg, tree, table)
        chapters_error = None
    except ValueError as problem:
        chapters_error = str(problem)

    # Stories are Typst files. Any other text file in a book folder would be
    # left out, or read as Typst, so it stops the build.
    other_files = [f"{f.relative_to(booklib.BOOK_DIR.parent).as_posix()}: the book reads only "
                   ".typ files. Rename it to .typ, or move it out of the book folder"
                   for folder in ("sketches", "chapters", "front-matter", "back-matter")
                   for f in sorted((booklib.BOOK_DIR / folder).glob("*.md"))]

    # line -> chapter map. A chapter id names the chapter's intro file and its
    # links in the book, so each must be a plain slug and used once.
    chapter_of_line, chapter_errors = {}, [chapters_error] if chapters_error else []
    chapter_errors.extend(other_files)
    ids = [ch.get("id", "") for ch in cfg["chapters"]]
    for chapter_id in dict.fromkeys(ids):
        if ids.count(chapter_id) > 1:
            chapter_errors.append(f"book.yaml: {ids.count(chapter_id)} chapters have the id "
                                  f"{chapter_id!r}; give each chapter its own id")
        if not re.fullmatch(r"[a-z0-9-]+", chapter_id):
            chapter_errors.append(f"book.yaml: the chapter id {chapter_id!r} may use only "
                                  "lowercase letters, digits and hyphens")
    for ch in cfg["chapters"]:
        for ln in ch.get("lines", []):
            if chapter_of_line.get(ln, ch["id"]) != ch["id"]:
                chapter_errors.append(f"book.yaml: the line {ln!r} is in two chapters, "
                                      f"{chapter_of_line[ln]!r} and {ch['id']!r}")
            chapter_of_line[ln] = ch["id"]

    # ancestors: refn -> info
    ancestors = {}
    unmapped_lines = set()
    for xref, ns in nums.items():
        p = tree.by_xref[xref]
        line = tree.line_of(ns[0], table)
        if line not in chapter_of_line:
            unmapped_lines.add(line)
        ancestors[p["refn"] or xref] = {
            "refn": p["refn"],
            "xref": xref,
            "name": f"{p['given'] or ''} {p['surname'] or ''}".strip(),
            "ahnentafel": ns,
            "generation": tree.generation(ns[0]),
            "line": line,
            "chapter": chapter_of_line.get(line),
            "conf": p.get("confidence"),
        }

    sections = []
    if booklib.SKETCH_DIR.exists():
        files = booklib.typ_files(booklib.SKETCH_DIR)
        for f in files:
            meta, body = booklib.parse_front_matter(f)
            covers = meta.get("covers") or ([meta["refn"]] if meta.get("refn") else [])
            has_prose = bool(
                "\n".join(
                    l for l in body.splitlines()
                    if l.strip() and not l.strip().startswith("<!--")
                    and not l.strip().startswith("//")
                ).strip()
            )
            sections.append({
                "path": f,
                "meta": meta,
                "covers": covers,
                "status": meta.get("status", "stub"),
                "has_prose": has_prose,
            })

    # sync state
    sync = {}
    if booklib.SYNC_JSON.exists():
        sync = json.loads(booklib.SYNC_JSON.read_text())

    # reconcile
    errors, warns, infos = chapter_errors, [], []
    claimed = {}
    for s in sections:
        try:
            scope = booklib.citation_scope(s["meta"], s["covers"], tree)
            s["citation_dependencies"] = {
                refn: tree.person_hash(refn) for refn in scope if refn not in s["covers"]}
        except ValueError as e:
            errors.append(f"{s['path'].name}: {e}")
            s["citation_dependencies"] = None
        refn = s["meta"].get("refn")
        if not refn:
            errors.append(f"{s['path'].name}: missing `refn` in front matter")
            continue
        # The book prints a story under its refn person. A refn that names no
        # ancestor, or one the story does not cover, would leave it out.
        if refn not in ancestors:
            errors.append(f"{s['path'].name}: refn {refn!r} is not an ancestor of {root!r}; "
                          "the story would be left out of the book. Use the id of the "
                          "ancestor the story is about")
        elif refn not in s["covers"]:
            errors.append(f"{s['path'].name}: refn {refn!r} is not in its covers list; "
                          f"add it, as covers: [{', '.join([refn, *s['covers']])}]")
        for cov in s["covers"]:
            if cov in claimed:
                errors.append(
                    f"duplicate: {cov!r} claimed by both {claimed[cov].name} and {s['path'].name}")
            else:
                claimed[cov] = s["path"]
            if cov not in ancestors:
                errors.append(
                    f"orphaned: {s['path'].name} covers {cov!r}, who is not a direct ancestor "
                    f"of {root!r} in the GEDCOM")
        # front-matter consistency for the primary refn
        a = ancestors.get(refn)
        if a:
            fm_ahnen = s["meta"].get("ahnentafel")
            if fm_ahnen:
                fm_list = [int(x) for x in (fm_ahnen if isinstance(fm_ahnen, list) else [fm_ahnen])]
                if fm_list != a["ahnentafel"]:
                    errors.append(
                        f"mismatch: {s['path'].name} front-matter ahnentafel {fm_list} != "
                        f"computed {a['ahnentafel']}")
            fm_line = s["meta"].get("line")
            if fm_line and fm_line != a["line"] and s["meta"].get("line_override") != "true":
                errors.append(
                    f"mismatch: {s['path'].name} front-matter line {fm_line!r} != computed "
                    f"{a['line']!r} (set line_override: true if intentional)")

    for ln in sorted(unmapped_lines):
        hint = (" (the book's subject and their brothers and sisters): run flyleaf import with "
                "your tree, --replace and --root to plan the chapters" if ln == "origin" else "")
        errors.append(f"unmapped-line: computed line {ln!r} is not assigned to any chapter "
                      f"in book.yaml{hint}")

    # A declared collateral scope belongs to its reviewable sketch, not every
    # essay in the chapter. Other prose keeps its existing ancestor scope.
    for folder in ("chapters", "front-matter", "back-matter"):
        for path in booklib.typ_files(booklib.BOOK_DIR / folder):
            meta, _ = booklib.parse_front_matter(path)
            if "citation_people" in meta:
                errors.append(f"{path.name}: citation_people is supported only in sketches")

    # per-person citation keys (slug collisions auto-suffixed; nothing to error)
    source_keys = tree.sources_by_person(refns=set(ancestors))

    # per-ancestor state
    states = {}
    for refn, a in ancestors.items():
        sec = claimed.get(refn)
        if sec is None:
            states[refn] = "missing"
            warns.append(f"missing: {a['name']} ({refn}, no. {a['ahnentafel'][0]}) has no narrative section")
            continue
        secobj = next(s for s in sections if s["path"] == sec)
        cur_hash = tree.person_hash(refn)
        known = sync.get(refn, {}).get("gedcom_sha")
        if secobj["status"] == "stub" or not secobj["has_prose"]:
            states[refn] = "stub"
            warns.append(f"stub: {a['name']} ({refn}) awaits prose")
        elif ((known and known != cur_hash)
              or (secobj["citation_dependencies"] is not None
                  and sync.get(refn, {}).get("citation_people", {})
                  != secobj["citation_dependencies"])):
            states[refn] = "stale"
            warns.append(f"stale: {a['name']} ({refn}) — GEDCOM or declared citation dependencies changed "
                         f"(flyleaf coverage --mark {refn} after updating)")
        else:
            states[refn] = secobj["status"]

    # citation lint over written sections (chapter intros lint against all
    # chapter persons; stubs skip — nothing to lint)
    lint = []
    for s in sections:
        if s["has_prose"] and s["citation_dependencies"] is not None:
            lint.extend(lint_section(tree, s))
    intro_dir = booklib.BOOK_DIR / "chapters"
    if intro_dir.exists():
        chapter_of_line2 = {ln: ch for ch in cfg["chapters"] for ln in ch.get("lines", [])}
        for f in booklib.typ_files(intro_dir):
            ch_id = f.stem.replace("-intro", "")
            ch_refns = [r for r, a in ancestors.items()
                        if chapter_of_line2.get(a["line"], {}) and a["chapter"] == ch_id]
            fake = {"path": f, "covers": ch_refns or list(ancestors)}
            meta, _ = booklib.parse_front_matter(f)
            if "citation_people" not in meta:
                lint.extend(lint_section(tree, fake))
    lint.extend(lint_gedcom_places(tree, ancestors))
    lint.extend(lint_gedcom_sources(tree, ancestors))
    warns.extend(lint)

    # ahnentafel gaps (parents known-unknown): info
    table_ns = set()
    for a in ancestors.values():
        table_ns.update(a["ahnentafel"])
    gaps = []
    for n in sorted(table_ns):
        for pn in (2 * n, 2 * n + 1):
            if pn not in table_ns and n != 1:
                gaps.append(pn)
    # only report the frontier (a missing parent of a KNOWN person)
    gaps = sorted(set(gaps))
    if gaps:
        infos.append("ahnentafel gaps (unknown parents of known ancestors): "
                     + ", ".join(str(g) for g in gaps))

    return {
        "root": root, "table": table, "ancestors": ancestors, "sections": sections,
        "states": states, "errors": errors, "warns": warns, "infos": infos,
        "gaps": gaps, "sync": sync, "chapter_of_line": chapter_of_line, "cfg": cfg,
        "source_keys": source_keys,
    }


def write_coverage_md(r):
    lines = []
    lines.append("# Book coverage dashboard")
    lines.append("")
    lines.append(f"*Generated by `scripts/book-coverage.py` — do not edit. "
                 f"Root: `{r['root']}` — {len(r['ancestors'])} persons "
                 f"(root + direct ancestors). Updated {date.today().isoformat()}.*")
    lines.append("")
    counts = {}
    for st in r["states"].values():
        counts[st] = counts.get(st, 0) + 1
    lines.append("| state | count |")
    lines.append("|---|---|")
    for st in ("final", "draft", "stub", "stale", "missing"):
        if counts.get(st):
            lines.append(f"| {st} | {counts[st]} |")
    lines.append("")
    # per chapter
    by_ch = {}
    for refn, a in r["ancestors"].items():
        by_ch.setdefault(a["chapter"] or "(unmapped)", []).append((a["ahnentafel"][0], refn, a))
    for ch in r["cfg"]["chapters"]:
        rows = sorted(by_ch.get(ch["id"], []))
        if not rows:
            continue
        done = sum(1 for _, refn, _ in rows if r["states"].get(refn) in ("draft", "final"))
        lines.append(f"## {ch['title']} — {done}/{len(rows)} written")
        lines.append("")
        lines.append("| no. | person | gen | line | conf | state |")
        lines.append("|---|---|---|---|---|---|")
        for n, refn, a in rows:
            ns = "/".join(str(x) for x in a["ahnentafel"])
            lines.append(f"| {ns} | {a['name']} (`{refn}`) | {a['generation']} | "
                         f"{a['line']} | {a['conf'] or '?'} | {r['states'].get(refn, '?')} |")
        lines.append("")
    if r["gaps"]:
        lines.append("## Research frontier (unknown parents)")
        lines.append("")
        lines.append("Ahnentafel numbers whose person is not yet known. Each is a place "
                     "to look next: " + ", ".join(str(g) for g in r["gaps"]))
        lines.append("")
    if r["errors"]:
        lines.append("## Errors")
        lines.append("")
        for e in r["errors"]:
            lines.append(f"- ❌ {e}")
        lines.append("")
    findings = [w for w in r["warns"] if re.search(r": [LG]\d+ |^G\d+ ", w)]
    if findings:
        lines.append("## Lint findings")
        lines.append("")
        for w in findings:
            lines.append(f"- ⚠ {w}")
        lines.append("")
    COVERAGE_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def current_sync_entry(tree, report, refn):
    """Acknowledge exactly this covered person's current sketch dependencies."""
    if report["errors"]:
        raise ValueError("Cannot mark current while coverage has errors: " + "; ".join(report["errors"]))
    if refn not in report["ancestors"]:
        raise ValueError(f"--mark-current: {refn!r} is not an ancestor refn")
    section = next((s for s in report["sections"] if refn in s["covers"]), None)
    entry = {"gedcom_sha": tree.person_hash(refn), "accepted_at": date.today().isoformat()}
    if section and section["citation_dependencies"]:
        entry["citation_people"] = section["citation_dependencies"].copy()
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="exit non-zero on warnings too")
    ap.add_argument("--mark-current", metavar="REFN", help="record current GEDCOM hash for REFN")
    ap.add_argument("--mark-current-all", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    tree = booklib.Tree()
    cfg = booklib.load_book_yaml()
    r = gather(tree, cfg)

    # staleness acknowledgment
    if args.mark_current or args.mark_current_all:
        sync = r["sync"]
        targets = list(r["ancestors"]) if args.mark_current_all else [args.mark_current]
        for refn in targets:
            try:
                sync[refn] = current_sync_entry(tree, r, refn)
            except ValueError as e:
                sys.exit(str(e))
        booklib.SYNC_JSON.write_text(json.dumps(sync, indent=2, sort_keys=True) + "\n")
        print(f"marked current: {', '.join(targets)}")
        r = gather(tree, cfg)  # recompute after ack

    write_coverage_md(r)

    if args.quiet:
        # Quiet hides the dashboard, never the reason a build stops.
        for e in r["errors"]:
            print(f"book coverage: ERROR: {e}", file=sys.stderr)
    else:
        print(f"book coverage — root {r['root']}: {len(r['ancestors'])} persons")
        for e in r["errors"]:
            print(f"  ERROR: {e}")
        for w in r["warns"]:
            print(f"  warn:  {w}")
        for i in r["infos"]:
            print(f"  info:  {i}")
        print(f"→ {COVERAGE_MD.relative_to(booklib.ROOT)}")

    if r["errors"]:
        sys.exit(1)
    if args.strict and r["warns"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
