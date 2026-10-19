#!/usr/bin/env python3
"""Assemble the family-history book into build/book.typ (Typst input).

The book compiles through Typst. Stories are hand-written Typst; this
script joins them with the generated register and apparatus at build time,
and never writes to a file the family edits.

Style rules cite Stratton and Hoff, *Guide to Genealogical Writing* (NEHGS,
2014): "Guide" for its chapters and "Manual" for its style manual.

  Part I  — narrative: front-matter essays, chapter intros, narrative
            sections (oldest→youngest within chapters)
  Part II — Genealogical Register: generated per-couple entries with complete
            vitals + marriages + children + per-person source footnotes
  Back    — bibliography (grouped by evidence tier), ahnentafel table,
            index of names (register numbers, not page numbers)

Author micro-syntax in sketches (rewritten here, validated against GEDCOM):
  #src("<key>")               citation -> #footnote[Evidence-Explained text]
  #refp("<refn>")             cross-ref -> linked "Name (no. N)"
  #fig("<name>", caption: "") figure    -> #book-fig(...)

Refuses to build while book-coverage reports errors.

Usage:
  book-assemble.py [--out build/book.typ]
  book-assemble.py --sources REFN     # list citation keys for a person
"""
import argparse
import importlib.util
import re
import sys
import build_clock
import flyleaf_settings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import booklib  # noqa: E402
import bookcharts  # noqa: E402
import bookbib  # noqa: E402

# Who the book is for, as in "Paternal grandparents of ..." (flyleaf.json).
# Who the book is written for, as in "Paternal grandparents of Jory, Tamsin,
# and Nora". Without the setting, the root person's first name.
SUBJECTS = flyleaf_settings.get("book.subjects_label")

BUILD = booklib.ROOT / "build"
FIGURES = BUILD / "figures"
TIER_NAMES = {
    "primary": "Primary record",
    "authoritative-secondary": "Authoritative secondary",
    "compiled-secondary": "Compiled secondary",
    "family-testimony": "Family testimony",
    "lead": "Collaborative database / lead",
    "unclassified": "Other source",
}
TIER_HEADINGS = {
    "primary": "Primary records",
    "authoritative-secondary": "Authoritative secondary works",
    "compiled-secondary": "Compiled secondary works",
    "family-testimony": "Family testimony",
    "lead": "Collaborative databases and leads",
    "unclassified": "Other sources",
}
# Rows of the ancestor table kept on one page with its closing note.
AHNENTAFEL_TAIL_ROWS = 8
BIBLIOGRAPHY_TAIL_ENTRIES = 3
TIER_ORDER = ["primary", "authoritative-secondary", "compiled-secondary", "family-testimony", "lead", "unclassified"]

MONTH_PROSE = {"JAN": "January", "FEB": "February", "MAR": "March", "APR": "April",
               "MAY": "May", "JUN": "June", "JUL": "July", "AUG": "August",
               "SEP": "September", "OCT": "October", "NOV": "November", "DEC": "December"}


def _coverage():
    spec = importlib.util.spec_from_file_location(
        "book_coverage", Path(__file__).resolve().parent / "book-coverage.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# At the start of a line these begin a heading, a list item, a numbered item
# or a term. A content block such as #footnote[...] starts a line too.
_LINE_START = re.compile(r"(?m)^([ \t]*)(=+|[-+/]|\d+\.)(?=\s|$)")


def esc(s):
    """Escape data text for insertion into Typst MARKUP context.

    Every character that starts code, math, a label, a reference, emphasis,
    raw text or a comment is escaped, so text from the tree prints as written.
    """
    if s is None:
        return ""
    s = str(s)
    s = s.replace("\\", "\\\\")
    for ch in "#$[]*_`@<>":
        s = s.replace(ch, "\\" + ch)
    s = s.replace("//", "\\/\\/")   # '//' would start a line comment
    s = s.replace("~", "\\~")        # non-breaking-space markup
    return _LINE_START.sub(lambda m: m.group(1) + "\\" + m.group(2), s)


def esc_str(s):
    """Escape data text for a Typst STRING literal."""
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


# Typst labels such as <reg-john-penhallow> are built from people's ids and
# chapter ids, so those must be plain slugs (validate-gedcom checks the ids).
LABEL_SAFE = re.compile(r"[a-z0-9-]+")


# A source written in the optional plain-text [Source] format (docs/gedcom.md)
# can carry clauses meant for the family, not the reader. They never print.
_INTERNAL_CLAUSE = re.compile(
    # a clause that is only where a copy is kept, or a research check:
    #   "images/records/1860-...pdf"                  (bare copy path)
    #   "full page image archived images/x.jpg"       (copy clause)
    #   "original scan archived images/...pdf"        (copy clause)
    #   "https://archive.org/details/x"               (bare URL — the link is
    #        rendered separately as "viewed at <site>"; Guide: never show raw URLs)
    #   "VERIFIED against the actual page <date>"     (research check)
    #   "RE-CAPTURED <date> ..."                      (research check)
    r"^(?:https?://|www\.)\S+$"
    r"|^(?:archived )?(?:images|build)/\S+"
    r"|.*\barchived\s+(?:images|build)/\S+"
    r"|^VERIFIED against\b"
    r"|^RE-CAPTURED\b", re.IGNORECASE)


def _is_tall(path):
    """True if the image is taller than wide (aspect h/w > 1.05)."""
    try:
        if path.suffix.lower() == ".svg":
            head = path.read_text(errors="ignore")[:2000]
            w = re.search(r'width="([\d.]+)', head)
            h = re.search(r'height="([\d.]+)', head)
            if w and h:
                return float(h.group(1)) / float(w.group(1)) > 1.05
            return False
        from PIL import Image
        with Image.open(path) as im:
            w, h = im.size
        return h / w > 1.05
    except Exception:
        return False


def display_label(label):
    """Reader-facing form of a source's label.

    Notes for the family in the optional [Source] format are stripped for
    DISPLAY ONLY (they read as clutter in footnotes): the uppercase
    IMAGE/IMAGES we-hold-the-scan marker, and whole clauses that are copy
    paths or research checks rather than citation content. Raw labels remain
    the identity for slugs and first-citation tracking, so this never
    touches slug computation. The first clause (the source's identity) is
    never dropped.
    """
    out = re.sub(r"\s+IMAGES?:?(?=\s|$|[,)—])", "", label or "")
    parts = [p.strip() for p in out.split(" — ")]
    kept = [parts[0]] + [p for p in parts[1:] if p and not _INTERNAL_CLAUSE.match(p)]
    out = " — ".join(kept)
    # raw URLs never display (Guide: name the site instead — the hyperlink is
    # rendered separately from rec["url"] as "viewed at <site>")
    out = re.sub(r"\s*(?:https?://|www\.)[^\s)\]]+", "", out)
    # bare repo paths never display either — enrich strips well-formed archive
    # clauses, but a path that survives (e.g. glued on after enrich eats the
    # clause's em-dash) must not reach print; drop its provenance lead-in too.
    # The first clause is the source's identity and is never touched.
    head, sep, tail = out.partition(" — ")
    if sep:
        tail = re.sub(r"[;,]?\s*(?:member[- ]shared?\s+cop(?:y|ies)\s+(?:\([^)]*\)\s*)?"
                      r"(?:also\s+)?(?:held|archived)\s+)?(?:images|build)/\S+", "", tail)
        out = head + sep + tail
    # A picture shared by another researcher on a genealogy site may be
    # credited to their user name. That name stays in the GEDCOM; readers see
    # only that a member shared it. Real-name credits (photographers,
    # institutions) are unaffected.
    out = re.sub(r"\(user [^)]+\)", "(member-contributed)", out)
    out = re.sub(r"shared on Ancestry by member \S+( \d{4})?", "shared via an Ancestry member tree", out)
    out = re.sub(r"member-shared copy \([^)]*\)", "member-shared copy", out)
    out = re.sub(r"\s+\)", ")", out)
    out = re.sub(r"\(\s*\)", "", out)           # emptied parentheticals
    out = re.sub(r"(?: — )+", " — ", out)       # collapsed separators
    # research-layer **emphasis** never displays (it typesets as literal
    # asterisks in Typst; the transcription's own capitals carry the weight)
    out = re.sub(r"\*\*(.+?)\*\*", r"\1", out)
    return re.sub(r"\s{2,}", " ", out).strip(" —,")


def roman(i):
    vals = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    out = ""
    for v, s in vals:
        while i >= v:
            out += s
            i -= v
    return out


def prose_date(s):
    """GEDCOM date -> prose: '14 MAR 1789' -> '14 March 1789'. A calendar
    other than the Gregorian is named after it: '14 March 1789 (Julian)'."""
    if not s:
        return s
    out, named = booklib.calendar(s)
    return _prose_date(out) + (f" ({named})" if named else "")


def _prose_date(out):
    for abbr, full in MONTH_PROSE.items():
        out = re.sub(rf"\b{abbr}\b", full, out)
    out = re.sub(r"\bABT\b\.?", "about", out)
    out = re.sub(r"\bBEF\b\.?", "before", out)
    out = re.sub(r"\bAFT\b\.?", "after", out)
    out = re.sub(r"\bBET\b\.?", "between", out)
    for token, word in {"AND": "and", "FROM": "from", "TO": "to",
                        "CAL": "calculated", "EST": "estimated"}.items():
        out = re.sub(rf"\b{token}\b", word, out)
    return out


def dated(s):
    """Prose date with 'in' before bare years and month-year forms, double
    dates included ('in 1720/21'; Guide, Manual: 'in May 1774')."""
    rest, named = booklib.calendar(s)
    d = _prose_date(rest)
    if re.match(r"^(?:[A-Z][a-z]+ )?\d{4}(?:/\d{1,4})?$", d):
        d = f"in {d}"
    return d + (f" ({named})" if named else "")


def where_and_when(place, date):
    """' at Halifax, Yorkshire, England, in 1720/21' (escaped): the place,
    then the date. A comma closes a place of several parts before its date."""
    out = f" {place_phrase(place)}" if place else ""
    if date:
        out += ("," if place and "," in place else "") + f" {esc(dated(date))}"
    return out


def years(p):
    return booklib.lifespan(p)


def display_name(p):
    return booklib.person_name(p) or "_____ _____"


# Guide (NEHGS 2014), Manual: "at" a specific town/city; "in" a larger area
# (county, state, country). Heuristic: a place naming a country, state,
# province, county or region -> "in"; a town, parish or cemetery -> "at".
US_STATES = (
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|"
    "Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|"
    "Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|"
    "New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|"
    "Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|"
    "Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming")
# Countries, the nations of the United Kingdom, provinces and states of
# Canada and Australia, and older names for regions, as a place of one part.
COUNTRIES = frozenset("""
Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|
Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bhutan|
Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burma|Burundi|
Cambodia|Cameroon|Canada|Cape Verde|Central African Republic|Chad|Chile|China|Colombia|
Comoros|Congo|Costa Rica|Croatia|Cuba|Cyprus|Czechia|Czech Republic|Denmark|Djibouti|
Dominica|Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|
Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Grenada|
Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hungary|Iceland|India|Indonesia|Iran|
Iraq|Ireland|Israel|Italy|Ivory Coast|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Korea|
Kosovo|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|
Luxembourg|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Marshall Islands|Mauritania|
Mauritius|Mexico|Micronesia|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|
Namibia|Nauru|Nepal|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Korea|
North Macedonia|Macedonia|Norway|Oman|Pakistan|Palau|Palestine|Panama|Papua New Guinea|
Paraguay|Peru|Philippines|Poland|Portugal|Qatar|Romania|Russia|Rwanda|Saint Kitts and Nevis|
Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|Sao Tome and Principe|
Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|
Solomon Islands|Somalia|South Africa|South Korea|South Sudan|Spain|Sri Lanka|Sudan|Suriname|
Sweden|Switzerland|Syria|Taiwan|Tajikistan|Tanzania|Thailand|Timor-Leste|Togo|Tonga|
Trinidad and Tobago|Tunisia|Turkey|Türkiye|Turkmenistan|Tuvalu|Uganda|Ukraine|
United Arab Emirates|United Kingdom|United States|United States of America|Uruguay|
Uzbekistan|Vanuatu|Vatican City|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe|
England|Scotland|Wales|Northern Ireland|Great Britain|Britain|UK|
Alberta|British Columbia|Manitoba|New Brunswick|Newfoundland|Newfoundland and Labrador|
Nova Scotia|Ontario|Prince Edward Island|Quebec|Saskatchewan|Northwest Territories|Nunavut|
Yukon|New South Wales|Queensland|South Australia|Tasmania|Victoria|Western Australia|
Northern Territory|
Prussia|Bavaria|Bohemia|Moravia|Holland|Flanders|Silesia|Saxony|Württemberg|Baden|Hesse|
Hanover|Alsace|Lorraine|Austria-Hungary|Ottoman Empire|Soviet Union|USSR|Yugoslavia|
Czechoslovakia|Persia|Ceylon|Siam|Ulster|Munster|Leinster|Connacht|Connaught|New England|
New France|New Netherland|Acadia""".replace("\n", "").split("|"))
# Regions take "in", not "at": counties, townships, colonies, provinces and
# territories, USA, two-letter codes, and the region names in flyleaf.json
# (places.region_names).
_REGION_RE = re.compile(
    r"^(?:[A-Za-z .'-]+ (?:Co\.|Co|County|Township|Twp\.?|Colony|Province|Territory)\b|USA|[A-Z]{2}|"
    + "|".join(re.escape(name) for name in flyleaf_settings.get("places.region_names", []))
    + r")(?:,|$)")
# A whole state ("Maryland, USA") is a region. Matched only at state level, so
# a town that shares a state's name ("Washington, Pennsylvania") keeps "at".
_STATE_RE = re.compile(r"^(?:" + US_STATES + r")(?:, (?:USA|United States))?$")


def at_or_in(place):
    head = (place or "").split(",")[0].strip()
    if _STATE_RE.match((place or "").strip()):
        return "in"
    # A place of one part names a country or region ("in Norway"), or a town
    # or cemetery recorded on its own ("at Penryn"). A note in brackets after
    # the name, as in "France (likely Toulouse)", does not count.
    name = re.split(r"\s*\(", head)[0]
    if "," not in (place or "") and (name in COUNTRIES or _REGION_RE.match(name)):
        return "in"
    if _REGION_RE.match(head):
        return "in"
    if re.match(r"^[A-Za-z .'-]+ (Co\.|Co|County)$", head):
        return "in"
    return "at"


# GEDCOM uncertainty idiom "Place (likely)" renders Register-style as
# "probably at/in Place" (Guide: qualify uncertain facts with probably/perhaps).
_UNCERTAIN_RE = re.compile(r"\s*\((likely|probably|possibly|perhaps)\)\s*$", re.I)


def place_phrase(place):
    """'City, State (likely)' -> 'probably at City, State' (escaped)."""
    m = _UNCERTAIN_RE.search(place or "")
    qual = ""
    if m:
        word = m.group(1).lower()
        qual = ("probably " if word in ("likely", "probably") else word + " ")
        place = _UNCERTAIN_RE.sub("", place)
    return f"{qual}{at_or_in(place)} {esc(place)}"


# Guide, Manual: child text abbreviates months of six or more letters.
CHILD_MONTHS = {"JAN": "Jan.", "FEB": "Feb.", "MAR": "March", "APR": "April",
                "MAY": "May", "JUN": "June", "JUL": "July", "AUG": "Aug.",
                "SEP": "Sept.", "OCT": "Oct.", "NOV": "Nov.", "DEC": "Dec."}


def child_date(s):
    """GEDCOM date -> abbreviated child-text style: '14 AUG 1873' -> '14 Aug. 1873'."""
    if not s:
        return s
    out, named = booklib.calendar(s)
    return _child_date(out) + (f" ({named})" if named else "")


def _child_date(out):
    for abbr, disp in CHILD_MONTHS.items():
        out = re.sub(rf"\b{abbr}\b", disp, out)
    out = re.sub(r"\bABT\b\.?", "ca.", out)
    out = re.sub(r"\bBEF\b\.?", "bef.", out)
    out = re.sub(r"\bAFT\b\.?", "aft.", out)
    for token, word in {"BET": "between", "AND": "and", "FROM": "from",
                        "TO": "to", "CAL": "calculated", "EST": "estimated"}.items():
        out = re.sub(rf"\b{token}\b", word, out)
    return out


def index_sort_key(name):
    """Index filing key (makeidx sort-key practice): case-folded,
    diacritics stripped, Mc- interfiled with Mac- (standard genealogical
    index convention — McGill files beside MacGregor). Particles ("van",
    "de") file as written, per US indexing practice."""
    import unicodedata
    s = unicodedata.normalize("NFKD", (name or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    if s.startswith("mc") and len(s) > 2 and s[2].isalpha():
        s = "mac" + s[2:]
    return s


def site_of(url):
    """Guide, Manual: cite 'viewed at Site.com' rather than a raw URL."""
    m = re.match(r"https?://(?:www\.)?([^/]+)", url or "")
    if not m:
        return url
    host = m.group(1)
    # render recognizable capitalization for common sites
    special = {"findagrave.com": "FindAGrave.com", "wikitree.com": "WikiTree.com",
               "familysearch.org": "FamilySearch.org", "ancestry.com": "Ancestry.com",
               "archive.org": "Archive.org", "americanancestors.org": "AmericanAncestors.org",
               "newspapers.com": "Newspapers.com"}
    return special.get(host.lower(), host)



_ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
             "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth",
             "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
             "nineteenth"]
_TENS = {2: ("twenty", "twentieth"), 3: ("thirty", "thirtieth"), 4: ("forty", "fortieth"),
         5: ("fifty", "fiftieth"), 6: ("sixty", "sixtieth"), 7: ("seventy", "seventieth"),
         8: ("eighty", "eightieth"), 9: ("ninety", "ninetieth")}


def ordinal(n):
    """3 -> "third", 21 -> "twenty-first"; from 100, "101st"."""
    if n < 20:
        return _ORDINALS[n]
    if n >= 100:
        suffix = "th" if n % 100 in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
        return f"{n}{suffix}"
    tens, ones = divmod(n, 10)
    return _TENS[tens][1] if not ones else f"{_TENS[tens][0]}-{_ORDINALS[ones]}"


def greats(g):
    """The prefix for an ancestor g generations up: "" for a grandparent (2),
    "great-" (3), "great-great-" (4), then "third great-" and onward."""
    if g <= 2:
        return ""
    return "great-" * (g - 2) if g <= 4 else f"{ordinal(g - 2)} great-"


def relation_tagline(ahn_list, covers_count, sex, subjects=None):
    """Plain-English relation of this section's subject(s) to the book's
    subjects (book.subjects_label in flyleaf.json): e.g. "Paternal
    great-great-grandparents of" followed by that label. Root (n=1) gets none."""
    n = min(ahn_list) if ahn_list else 1
    if n <= 1:
        return None
    g = n.bit_length() - 1
    side = "Paternal" if (n >> (g - 1)) == 2 else "Maternal"
    if covers_count > 1:
        word = "parents" if g == 1 else greats(g) + "grandparents"
    else:
        gendered = "father" if sex == "M" else ("mother" if sex == "F" else "parent")
        word = gendered if g == 1 else greats(g) + "grand" + gendered
    if g == 1:
        side = ""
    tag = f"{side} {word} of {subjects or SUBJECTS}".strip()
    return tag[0].upper() + tag[1:]


def citation_identity(rec):
    """Distinguish source uses without confusing identical titles or hosts."""
    return (rec.get("source_id"), rec["label"], rec.get("url") or "", rec["tier"])


def bibliography_use(person, key):
    """Invisible accounting marker inside the rendered citation."""
    return (f'#metadata((person: "{esc_str(person)}", key: "{esc_str(key)}"))'
            ' <bibliography-use>')


def linked_source_label(label, url=None):
    """Display a source label and optional access link without double punctuation."""
    result = esc(display_label(label))
    if url:
        # Retain the label's punctuation, including abbreviation periods.
        # A closing quotation mark can follow the full stop ("...the deed.").
        closed = re.search(r'[.?!]\)?["\u201d\u2019\']*$', result)
        joiner = ' Viewed at ' if closed else ', viewed at '
        result += f'{joiner}#link("{esc_str(url)}")[{esc(site_of(url))}]'
    return result


def citation_body(rec, first=None, reg_no=None):
    """Reader-facing citation, shared by claim footnotes and source paragraphs.

    Only an explicit short title is safe to abbreviate. Legacy labels have no
    structure that identifies where their locator or qualification ends.
    """
    if first is not None:
        label = rec.get("short") or rec["label"]
        result = esc(display_label(label))
        if isinstance(first, int) and first != reg_no:
            result += f" (cited in full at no. {first})"
        elif isinstance(first, tuple) and first != reg_no:
            _, refn, number = first
            locator = str(number) if str(number).startswith("under ") else f"no. {number}"
            result += (f" (cited in full in #link(<sources-{refn}>)"
                       f"[Sources for the Register, {locator}])")
        # A quotation that already closes its sentence ("...aged 80.") takes
        # no second full stop, even after a quote within the quote.
        if re.search(r'[.?!]\)?["\u201d\u2019\']+$', result):
            return result
        return result.rstrip(".") + "."
    result = linked_source_label(rec["label"], rec.get("url"))
    tier = TIER_NAMES.get(rec["tier"], rec["tier"])
    return result + f' #text(style: "italic")[({esc(tier)}.)]'


# GEDCOM PEDI values printed after a child's name in a family's list.
CHILD_KINDS = {"adopted": "adopted", "foster": "foster child"}


class Assembler:
    def __init__(self):
        self.tree = booklib.Tree()
        self.cfg = booklib.load_book_yaml()
        self.root = booklib.root_refn(self.cfg)
        unsafe = [refn for refn in self.tree.by_refn if not LABEL_SAFE.fullmatch(refn)]
        unsafe += [ch.get("id", "") for ch in self.cfg["chapters"]
                   if not LABEL_SAFE.fullmatch(ch.get("id", ""))]
        if unsafe:
            raise ValueError("People's ids and chapter ids may use only lowercase letters, "
                             "digits and hyphens: " + ", ".join(map(repr, sorted(unsafe))))
        self.table = self.tree.ahnentafel(self.root)
        self.nums = self.tree.numbers_by_xref(self.table)
        self.cov = _coverage().gather(self.tree, self.cfg)
        self.cfg = self.cov["cfg"]  # each chapter's lines written out
        self.src_keys = self.tree.sources_by_person()
        self.bibliography_policy = bookbib.load_policy()
        self.index = {}
        self.cited_full = {}   # source identity -> location of its full title
        self.cited_uses = set()  # qualified citation identities actually dispatched
        self.warnings = []
        # refn -> refn of the NARRATIVE section that covers them (couple sections;
        # register entries are per-person and always linked directly)
        self.reg_anchor = {}
        for s in self.cov["sections"]:
            primary = s["meta"].get("refn")
            for cov in s["covers"]:
                self.reg_anchor[cov] = primary
        for refn in self.cov["ancestors"]:
            self.reg_anchor.setdefault(refn, refn)

    # ---------- lookups ----------

    def person_by_refn(self, refn):
        return self.tree.by_refn.get(refn)

    def num_of_refn(self, refn):
        p = self.person_by_refn(refn)
        if not p:
            return None
        ns = self.nums.get(p["xref"])
        return ns[0] if ns else None

    def add_index(self, p, tag):
        key = booklib.index_name(p)
        self.index.setdefault(key, set()).add(tag)
        for name in p.get("alternate_names", []):
            alias = booklib.index_name(name)
            if any(alias):
                self.index.setdefault(alias, set()).add(tag)
        # Names are not identities: two women with the same name must not
        # acquire each other's married-name references.
        if not hasattr(self, "indexed_people"):
            self.indexed_people = {}
        self.indexed_people.setdefault(p["xref"], set()).add(tag)

    # ---------- citations ----------

    def footnote_typ(self, refns, key, reg_no=None):
        """A separate claim anchor; adjacent identical uses may coalesce."""
        match = booklib.resolve_source(self.src_keys, refns, key)
        if match is None:
            return None
        person, rec = match
        # Qualification selects the owner; the stored use still names that
        # owner's native key, not the author-call spelling "person::key".
        key = key.split("::")[-1]
        marker = reg_no if reg_no is not None else "prose"
        identity = citation_identity(rec)
        if getattr(self, "_last_fn", None) == (identity, marker):
            return ""
        self._last_fn = (identity, marker)
        source = bookbib.identity(rec)
        first = self.cited_full.get(source)
        content = citation_body(rec, first, reg_no)
        self.cited_full.setdefault(source, marker)
        self.cited_uses.add(identity)
        return f"#footnote[{content}{bibliography_use(person, key)}]"

    def reference_notes(self, refn, keys, reg_no):
        """Broader references grouped by person in Sources for the Register.

        Identical uses can share a paragraph; metadata still accounts for every
        authoring key. No source title assigns a reference to a vital event.
        """
        groups = {}
        for key in keys:
            rec = self.src_keys[refn][key]
            group = groups.setdefault(citation_identity(rec), {"rec": rec, "keys": []})
            group["keys"].append(key)
        items = []
        marker = ("sources", refn, reg_no)
        for identity, group in groups.items():
            source = bookbib.identity(group["rec"])
            content = citation_body(group["rec"], self.cited_full.get(source), marker)
            content += "".join(bibliography_use(refn, key) for key in group["keys"])
            self.cited_full.setdefault(source, marker)
            self.cited_uses.add(identity)
            key_tuple = ", ".join('"' + esc_str(k) + '"' for k in group["keys"]) + ","
            items.append(f'(refn: "{esc_str(refn)}", keys: ({key_tuple}), body: [{content}])')
        self._last_fn = None
        return "#register-sources((\n" + ",\n".join(items) + ",\n))" if items else ""

    def cites_by_fact(self, refn):
        """Only explicit source placement associates a citation with a fact."""
        groups = {"birth": [], "baptism": [], "christening": [], "death": [], "cremation": [],
                  "burial": [], "marriage": [], "divorce": [], "general": []}
        for key, rec in self.src_keys.get(refn, {}).items():
            facts = {item["kind"] for item in rec.get("facts", [])}
            for fact in facts or {"general"}:
                groups.get(fact, groups["general"]).append(key)
        return groups

    def marriage_cites(self, refn, family):
        return [key for key, rec in self.src_keys.get(refn, {}).items()
                if {"kind": "marriage", "family": family["xref"]} in rec.get("facts", [])]

    def fn(self, refn, keys, reg_no=None):
        # Separate fact clauses need their own anchors even when they use the
        # same document. Coalescing remains available within a run of citations.
        self._last_fn = None
        notes = [self.footnote_typ([refn], k, reg_no=reg_no) for k in keys]
        return "#super[, ]".join(note for note in notes if note)

    def auto_cites(self, refn):
        keys = self.src_keys.get(refn, {})
        return "".join(self.footnote_typ([refn], k) or "" for k in keys)

    # ---------- prose processing ----------

    def process_prose(self, body, covers, section_name, *, meta=None):
        """Rewrite #src/#refp/#fig author calls; strip stub comments."""
        source_scope = booklib.citation_scope(meta or {}, covers, self.tree)
        body = re.sub(r"^//.*$", "", body, flags=re.M).strip()
        self._last_fn = None
        last_source_end = 0
        adjacent_note = False

        def sub_src(m):
            nonlocal last_source_end, adjacent_note
            adjacent = not body[last_source_end:m.start()].strip()
            if not adjacent:
                self._last_fn = None
                adjacent_note = False
            last_source_end = m.end()
            key = m.group(1)
            fn = self.footnote_typ(source_scope, key)
            if fn is None:
                self.warnings.append(
                    f"{section_name}: #src(\"{key}\") matches no source on {source_scope} "
                    f"(flyleaf sources {source_scope[0] if source_scope else 'person-refn'})")
                return '#text(fill: red)[⟨unresolved citation⟩]'
            separator = "#super[, ]" if adjacent_note and fn else ""
            adjacent_note = adjacent_note or bool(fn)
            return separator + fn

        def sub_ref(m):
            refn = m.group(1)
            p = self.person_by_refn(refn)
            if not p:
                self.warnings.append(f"{section_name}: #refp(\"{refn}\") unknown refn")
                return esc(refn)
            n = self.num_of_refn(refn)
            if n:
                self.add_index(p, str(n))
                return f"#link(<reg-{refn}>)[{esc(display_name(p))} (no. {n})]"
            return esc(display_name(p))

        def sub_fig(m):
            name, caption = m.group(1), m.group(2) or ""
            cand = booklib.figure_path(name)
            if cand is not None:
                rel = cand.relative_to(booklib.ROOT).as_posix()
                # Static sizing avoids Typst layout convergence problems.
                fn_name = "book-fig-tall" if _is_tall(cand) else "book-fig"
                return f'#{fn_name}("/{esc_str(rel)}", "{esc_str(caption)}")'
            self.warnings.append(f"{section_name}: figure {name!r} not found")
            return f'#text(fill: red)[⟨missing figure {esc(name)}⟩]'

        body = re.sub(r'#src\("([a-z0-9-]+(?:::[a-z0-9-]+)?)"\)', sub_src, body)
        body = re.sub(r'#refp\("([a-z0-9-]+)"\)', sub_ref, body)
        body = re.sub(r'#fig\("([a-zA-Z0-9._/-]+)"(?:,\s*caption:\s*"([^"]*)")?\)', sub_fig, body)
        return body

    # ---------- Part I ----------

    def narrative(self):
        out = []
        by_line = {}
        for s in self.cov["sections"]:
            refn = s["meta"].get("refn")
            a = self.cov["ancestors"].get(refn)
            if a:
                by_line.setdefault(a["line"], []).append((a, s))

        for chi, ch in enumerate(self.cfg["chapters"], start=1):
            out.append(f"= Chapter {chi}. {esc(ch['title'])} <ch-{ch['id']}>")
            out.append("")
            intro = booklib.BOOK_DIR / "chapters" / f"{ch['id']}-intro.typ"
            rows = []
            for ln in ch.get("lines", []):
                rows.extend(by_line.get(ln, []))
            rows.sort(key=lambda t: (-t[0]["generation"], t[0]["ahnentafel"][0]))
            if intro.exists():
                _, body = booklib.parse_front_matter(intro)
                covers_all = list(dict.fromkeys(c for _a, s in rows for c in s["covers"]))
                out.append(self.process_prose(body, covers_all, intro.name))
                out.append("")
            if ch.get('charts') != 'false':
                out.extend(self.chapter_charts(ch['id']))
            for a, s in rows:
                p = self.person_by_refn(a["refn"])
                spouse_names = [display_name(self.person_by_refn(c))
                                for c in s["covers"][1:] if self.person_by_refn(c)]
                override = s["meta"].get("title")
                title = override or display_name(p)
                if not override:
                    if spouse_names:
                        title += " & " + ", ".join(spouse_names)
                    yrs = years(p)
                    if yrs:
                        title += f" ({yrs})"
                if s["meta"].get("continuous") == "true":
                    # The author supplies movement headings across generations.
                    # Keep a stable target for all associated register links.
                    out.append(f'#metadata(none) <nar-{a["refn"]}>')
                else:
                    out.append(f"== {esc(title)} <nar-{a['refn']}>")
                    out.append("")
                    tag = relation_tagline(a.get("ahnentafel") or [], len(s["covers"]), p.get("sex"),
                                           SUBJECTS or self.root_first_name())
                    if tag:
                        out.append(f"#relation-line[{esc(tag)}]")
                        out.append("")
                state = self.cov["states"].get(a["refn"])
                if any(self.cov["states"].get(c) == "stale" for c in s["covers"]):
                    out.append('#draft-note[The underlying records for this section have been '
                               'updated since this prose was written; revision pending.]')
                    out.append("")
                if state == "stub" or not s["has_prose"]:
                    out.append(f"_A narrative account of {esc(display_name(p))} is in "
                               f"preparation. The register gives what the tree records, "
                               f"#link(<reg-{a['refn']}>)[no. {a['ahnentafel'][0]}]._")
                else:
                    meta, body = booklib.parse_front_matter(s["path"])
                    out.append(self.process_prose(body, s["covers"], s["path"].name, meta=meta))
                out.append("")
                for cov in s["covers"]:
                    pp = self.person_by_refn(cov)
                    n = self.num_of_refn(cov)
                    if pp and n:
                        self.add_index(pp, str(n))
        return "\n".join(out)

    def chapter_charts(self, chapter_id):
        if not hasattr(self, '_print_charts'):
            self._print_charts = bookcharts.load_manifest(self.tree, FIGURES, self.cfg)
        chapter = self._print_charts['chapters'][chapter_id]
        by_number = {p['number']: p for p in chapter['panels']}
        out = []
        for i, panel in enumerate(chapter['panels']):
            out.extend(['#pagebreak(weak: true)', ''])
            if i == 0:
                out.extend(['#text(size: 9pt)[Numbers identify register entries. Lines run '
                            'from parents to a child: the left connection identifies the '
                            'first person in a box, the right connection the second. '
                            '“c.” means about. Chart references continue the family across pages.]', ''])
            def chart_ref(number):
                target = by_number[number]
                label = f'chart-{chapter_id}-{target["focus"]}'
                return f'#ref(<{label}>) (#ref(<{label}>, form: "page"))'
            people = chapter['graph']['nodes'][str(panel['focus'])]['people']
            caption = esc(' and '.join(p['name'] for p in people)) + '.'
            if panel['earlier']:
                caption += ' Earlier generations: ' + '; '.join(
                    f'no. {n} in {chart_ref(number)}' for n, number in panel['earlier'].items()) + '.'
            if panel['later']:
                caption += ' Later generations: ' + ', '.join(chart_ref(n) for n in panel['later']) + '.'
            out.extend([f'#book-chart("/build/figures/{panel["file"]}", [{caption}]) '
                        f'<chart-{chapter_id}-{panel["focus"]}>', ''])
        # The narrative resumes on its own page after the linked chart set.
        out.extend(['#pagebreak(weak: true)', ''])
        return out

    # ---------- Part II ----------

    def register_chapters(self):
        """Use the same family sequence for the register and its references."""
        by_line = {}
        for refn, a in self.cov["ancestors"].items():
            by_line.setdefault(a["line"], []).append(a)
        for ch in self.cfg["chapters"]:
            rows = []
            for ln in ch.get("lines", []):
                rows.extend(by_line.get(ln, []))
            if not rows:
                continue
            rows.sort(key=lambda a: (-a["generation"], a["ahnentafel"][0]))
            yield ch, rows

    def register(self):
        self._collateral_locations = set()
        self._continued_families = set()
        self._family_locations = set()
        out = ["#set par(first-line-indent: 0em)", ""]
        introduction = ("_Numbers are ahnentafel numbers: a person's father is twice "
               f"their number; their mother, twice plus one. {esc(self.root_first_name())} is no. 1. "
               "Footnotes identify evidence attached to particular facts. "
               "Unnumbered family continuations follow recorded descendants; they "
               "do not change the ancestor numbers or imply complete child lists. "
               "Additional references are grouped by entry in Sources for the Register._")
        # Each ancestor gets a numbered entry. Marriage and children appear
        # with the husband, or with the ancestor whose spouse is outside the table.
        for ch, rows in self.register_chapters():
            breaks = set(ch.get("register_break_before", []))
            burial_breaks = set(ch.get("register_break_before_burial", []))
            marriage_breaks = set(ch.get("register_break_before_marriage", []))
            self._child_breaks = set(ch.get("register_break_before_child", []))
            self._collateral_breaks = set(ch.get("register_break_before_collateral", []))
            self._used_child_breaks, self._used_collateral_breaks = set(), set()
            unknown = (breaks | burial_breaks | marriage_breaks) - {a["refn"] for a in rows}
            if unknown:
                raise ValueError(f"Register break targets outside {ch['id']}: {sorted(unknown)}")
            out.extend([f"= Register: {esc(ch['title'])} <reg-ch-{ch['id']}>", ""])
            if introduction:
                out.extend([introduction, ""])
                introduction = None
            for a in rows:
                if a["refn"] in breaks:
                    out.extend(['#pagebreak(weak: true)', ''])
                out.extend(self.register_entry(
                    a, break_before_burial=a["refn"] in burial_breaks,
                    break_before_marriage=a["refn"] in marriage_breaks))
            unused = ((self._child_breaks - self._used_child_breaks) |
                      (self._collateral_breaks - self._used_collateral_breaks))
            if unused:
                raise ValueError(f"Unused relative break targets in {ch['id']}: {sorted(unused)}")
        return "\n".join(out)

    def register_references(self):
        self._reference_people = set()
        out = ["= Sources for the Register <register-references>", "",
               "These references provide additional information about the people "
               "in the register. They follow the same family order and entry numbers. "
               "Evidence attached to particular facts appears in the register's "
               "footnotes; inclusion here does not establish every fact in an entry.", ""]
        for ch, rows in self.register_chapters():
            entries = [(p, tag, anchor, self.cites_by_fact(p["refn"])["general"])
                       for p, tag, anchor in self.reference_scope(rows)]
            entries = [entry for entry in entries if entry[3]]
            if not entries:
                continue
            out.extend([f"== {esc(ch['title'])}", ""])
            for p, tag, anchor, keys in entries:
                refn = p["refn"]
                name = esc(display_name(p))
                marker = tag if tag.startswith("under ") else int(tag.split("/")[0])
                out.extend([f"=== {tag}. #smallcaps[{name}] <sources-{refn}>", "",
                            f'#block(sticky: true)[_Register entry: #ref(<{anchor}>, form: "page")._]', "",
                            self.reference_notes(refn, keys, marker), ""])
        return "\n".join(out)

    def reference_scope(self, rows):
        """People named in these entries, including a named spouse's children.

        Separate spouse families need recorded children to be continued;
        spouse ancestry and unrelated childless unions are not imported.
        The compiled-key checker derives its own graph scope independently.
        A person appearing in two branches receives one source section.
        """
        if not hasattr(self, "_reference_people"):
            self._reference_people = set()
        out, expanded = [], set()

        def add(p, n, own=None):
            if p["xref"] in self._reference_people:
                return
            self._reference_people.add(p["xref"])
            tag = "/".join(map(str, own)) if own else f"under {n}"
            anchor = ("reg-" if own else "reg-collateral-") + p["refn"]
            out.append((p, tag, anchor))

        def families(p, n, *, children_only=False):
            visit = (p["xref"], children_only)
            if visit in expanded:
                return
            expanded.add(visit)
            descendants, partners = [], []
            for fam in self.tree.spouse_families(p["xref"]):
                if children_only and not fam["chil"]:
                    continue
                spouse_x = fam["wife"] if fam["husb"] == p["xref"] else fam["husb"]
                if fam["husb"] != p["xref"] and spouse_x in self.nums:
                    continue
                sp = self.tree.by_xref.get(spouse_x)
                if sp and spouse_x not in self.nums:
                    add(sp, n)
                    partners.append(sp)
                kids = self.tree.children_of_family(fam)
                for k in kids:
                    if k["xref"] not in self.nums:
                        add(k, n)
                        descendants.append(k)
            for sp in partners:
                families(sp, n, children_only=True)
            for k in descendants:
                families(k, n)

        for a in rows:
            p = self.person_by_refn(a["refn"])
            add(p, a["ahnentafel"][0], own=a["ahnentafel"])
            families(p, a["ahnentafel"][0])
        return out

    def collateral_navigation(self, p):
        """One stable location and general-reference pointer for each relative."""
        if not hasattr(self, "_collateral_locations"):
            self._collateral_locations = set()
        if p["xref"] in self._collateral_locations:
            return ""
        self._collateral_locations.add(p["xref"])
        result = f' <reg-collateral-{p["refn"]}>'
        if self.cites_by_fact(p["refn"])["general"]:
            result += (f' #text(size: 8.8pt, fill: iron)[_Sources: '
                       f'#ref(<sources-{p["refn"]}>, form: "page")._]')
        return result

    def collateral_families(self, p, a, *, children_only=False):
        """Continue descendant families without giving them ancestor numbers.

        A named spouse's separate household is limited to recorded children;
        it cannot import that spouse's ancestry or another childless union.
        Whole families remain breakable. Only individual vital paragraphs and
        the existing child rows use the tested unbreakable layout treatment.
        """
        if not hasattr(self, "_continued_families"):
            self._continued_families = set()
        if p["xref"] in self.nums:
            return []
        families = []
        for fam in self.tree.spouse_families(p["xref"]):
            if children_only and not fam["chil"]:
                continue
            if fam["xref"] in self._continued_families:
                continue
            if any(x in self.nums for x in (fam["husb"], fam["wife"])):
                continue  # the numbered entry carries this union
            self._continued_families.add(fam["xref"])
            families.append(fam)
        if not families:
            return []
        n = a["ahnentafel"][0]
        if not hasattr(self, "_family_locations"):
            self._family_locations = set()
        continued = p["xref"] in self._family_locations
        self._family_locations.add(p["xref"])
        title = f'Family of {esc(display_name(p))}' + (' (continued)' if continued else '')
        anchor = '' if continued else f' <family-{p["refn"]}>'
        lines = [f'#block(sticky: true)[*{title}*{anchor}]', ""]
        if not continued and p["refn"] in getattr(self, "_collateral_breaks", set()):
            self._used_collateral_breaks.add(p["refn"])
            lines[0:0] = ['#pagebreak(weak: true)', '']
        descendants, partners = [], []
        for fam in families:
            spouse_x = fam["wife"] if fam["husb"] == p["xref"] else fam["husb"]
            sp = self.tree.by_xref.get(spouse_x)
            if sp:
                if fam.get("marr_recorded"):
                    sentence = esc(display_name(p)) + " married"
                    sentence += where_and_when(fam["marr_plac"], fam["marr_date"])
                    if fam["marr_plac"] or fam["marr_date"]:
                        sentence += ","
                    sentence += " " + esc(display_name(sp)) + "."
                    sentence += self.fn(p["refn"], self.marriage_cites(p["refn"], fam), reg_no=n)
                else:
                    sentence = (f'The family record links {esc(display_name(p))} and '
                                f'{esc(display_name(sp))}; no marriage event is recorded.')
                lines.extend([sentence, ""])
                body = self.vitals(sp, self.vital_notes(sp, n))
                body += self.collateral_navigation(sp)
                lines.extend(["#block(breakable: false)[" + body + "]", ""])
                self.add_index(sp, f"under {n}")
                partners.append(sp)
            for divorce in fam.get("divorces", []):
                sentence = "Their divorce was recorded" if sp else "A divorce was recorded"
                sentence += where_and_when(divorce["place"], divorce["date"])
                keys = self.tree.keys_for(p, divorce["uses"])
                lines.extend([sentence + "." + self.fn(p["refn"], keys, reg_no=n), ""])
            kids = self.tree.children_of_family(fam)
            if kids:
                father = self.tree.by_xref.get(fam["husb"])
                mother = self.tree.by_xref.get(fam["wife"])
                lines.extend([self.children_block(father or mother, mother if father else None, kids, a,
                                                  family=fam["xref"]), ""])
                descendants.extend(kids)
        for sp in partners:
            lines.extend(self.collateral_families(sp, a, children_only=True))
        for k in descendants:
            lines.extend(self.collateral_families(k, a))
        return lines

    def _spouse_in_table(self, xref):
        return xref in self.nums

    def register_entry(self, a, *, break_before_burial=False, break_before_marriage=False):
        p = self.person_by_refn(a["refn"])
        if break_before_burial and not p.get("burials"):
            raise ValueError(f"Register burial break target has no burial events: {a['refn']}")
        groups = self.cites_by_fact(a["refn"])
        ns = "/".join(str(x) for x in a["ahnentafel"])
        head = [f"=== {ns}. #smallcaps[{esc(display_name(p))}] <reg-{a['refn']}>", ""]
        # Keep navigation with the heading, so a final pointer cannot be
        # stranded above the next person's entry after a footnote-heavy page.
        pointers = []
        nar_anchor = self.reg_anchor.get(a["refn"], a["refn"])
        state = self.cov["states"].get(nar_anchor)
        if state not in ("stub", "missing", None):
            pointers.append(f"_Narrative: #link(<nar-{nar_anchor}>)[Part I]._")
        if groups["general"]:
            pointers.append(f'_Additional references: #ref(<sources-{a["refn"]}>, form: "page")._')
        if pointers:
            head.extend(['#text(size: 8.8pt, fill: iron)[' + " ".join(pointers) + ']', ""])
        # Confidence tiers are research bookkeeping. The family reads the
        # evidence itself in the footnotes and Sources for the Register.

        n0 = a["ahnentafel"][0]
        # Generate citations in reading order, including when burial is moved
        # to its own page. Their first/full-source state depends on this order.
        notes = self.vital_notes(p, n0)
        sent = self.vitals(p, notes, include_burials=not break_before_burial)
        # heading + vitals stay together, unbreakable: a vitals paragraph
        # straddling a page break strands its footnote entries a page before
        # their anchors (github.com/typst/typst/issues/5314, as with ledger cards)
        lines = ["#block(breakable: false)["] + head
        marriage_here = []
        for fam in self.tree.spouse_families(p["xref"]):
            spouse_x = fam["wife"] if fam["husb"] == p["xref"] else fam["husb"]
            is_husband = fam["husb"] == p["xref"]
            # husband's entry carries the marriage; a wife's entry carries it
            # only when her husband is not himself in the table (e.g., no. 1)
            if is_husband or not self._spouse_in_table(spouse_x):
                marriage_here.append((fam, spouse_x))

        if break_before_marriage and not any(spouse_x in self.tree.by_xref
                                             for _, spouse_x in marriage_here):
            raise ValueError(f"Register marriage break target has no rendered marriage: {a['refn']}")

        if sent:
            lines.append(sent)
        lines.append("]")
        lines.append("")
        if break_before_burial:
            lines.extend(['#pagebreak(weak: true)', '', '#block(breakable: false)['])
            lines.extend(self.burial_sentences(p, notes["burials"]))
            lines.extend([']', ''])
        self.add_index(p, str(a["ahnentafel"][0]))

        # The recorded FAMS list need not be an exhaustive marriage history.
        # Keep any source's own ordinal wording in its citation; never derive
        # a first/second marriage claim from this display sequence.
        # Special type treatment distinguishes the direct-ancestor spouse.
        multi = sum(spouse_x in self.tree.by_xref for _fam, spouse_x in marriage_here) > 1
        descendants, partners = [], []
        if break_before_marriage:
            lines.extend(['#pagebreak(weak: true)', ''])
        for family_position, (fam, spouse_x) in enumerate(marriage_here):
            sp = self.tree.by_xref.get(spouse_x)
            if sp:
                if (spouse_x not in self.nums and
                        sp["refn"] in getattr(self, "_collateral_breaks", set())):
                    self._used_collateral_breaks.add(sp["refn"])
                    lines.extend(['#pagebreak(weak: true)', ''])
                recorded_marriage = bool(fam.get("marr_recorded"))
                # A preceding union can end with a child's or partner's name.
                # Restate this entry's subject for every later family slot,
                # including when an earlier slot had no identified spouse.
                subject = esc(display_name(p))
                if family_position == 0:
                    subject = {"M": "He", "F": "She"}.get(p.get("sex"), subject)
                if recorded_marriage:
                    m = subject + " married"
                else:
                    m = (f"Partner of {esc(display_name(p))}:" if family_position
                         else "Partner:")
                has_pd = recorded_marriage and bool(fam.get("marr_plac") or fam.get("marr_date"))
                if recorded_marriage:
                    m += where_and_when(fam.get("marr_plac"), fam.get("marr_date"))
                sn = self.nums.get(spouse_x)
                sp_name = (f"*#smallcaps[{esc(display_name(sp))}]*" if sn or not multi
                           else esc(display_name(sp)))
                m += ("," if has_pd else "") + f" {sp_name}"
                if sn:
                    m += f" [no. {sn[0]}]"
                m += "."
                if recorded_marriage:
                    m += self.fn(a["refn"], self.marriage_cites(a["refn"], fam), reg_no=n0)
                if not sn:
                    m += self.collateral_navigation(sp)
                lines.append(m)
                lines.append("")
                # A partner outside the ancestor table has no later entry
                # to carry their vitals. Keep these facts and citations on
                # that partner, separate from the union's marriage note.
                if not sn and any(sp.get(k) for k in (
                        "birth_date", "birth_place", "death_date", "death_place", "births",
                        "deaths", "baptisms", "christenings", "burials", "cremations")):
                    body = self.vitals(sp, self.vital_notes(sp, n0))
                    lines.extend(["#block(breakable: false)[" + body + "]", ""])
                # every-name index: spouses named in the register are findable
                self.add_index(sp, f"under {n0}" if not sn else str(sn[0]))
                if not sn:
                    partners.append(sp)
            for divorce in fam.get("divorces", []):
                sentence = "Their divorce was recorded" if sp else "A divorce was recorded"
                sentence += where_and_when(divorce["place"], divorce["date"])
                sentence += "." + self.fn(a["refn"], self.tree.keys_for(p, divorce["uses"]),
                                          reg_no=n0)
                lines.extend([sentence, ""])
            kids = self.tree.children_of_family(fam)
            if kids:
                father = self.tree.by_xref.get(fam["husb"])
                mother = self.tree.by_xref.get(fam["wife"])
                lines.append(self.children_block(father or mother, mother if father else None, kids, a,
                                                 family=fam["xref"]))
                lines.append("")
                descendants.extend(kids)
        # Finish this person's unions before changing subject to descendants.
        # Otherwise a later "He married" can appear to refer to a son-in-law.
        for sp in partners:
            lines.extend(self.collateral_families(sp, a, children_only=True))
        for k in descendants:
            lines.extend(self.collateral_families(k, a))
        return lines

    def children_block(self, p, sp, kids, a, family=None):
        """Guide, Manual: children's intro restates both parents, father first,
        mother's maiden name in parentheses, shared surname once. Child text is
        abbreviated (b./d./m., short months) with semicolons; a carried-forward
        child shows their number in bold and only birth data."""
        f_given = (p.get("given") or "").strip()
        intro = f"Children of {esc(f_given)}"
        if not sp:
            intro = f"Children of {esc(display_name(p))}"
        if sp:
            s_given = (sp.get("given") or "").strip()
            s_maiden = (sp.get("surname") or "").strip()
            f_surname = (p.get("surname") or "").strip()
            intro += f" and {esc(s_given)}"
            if s_maiden and s_maiden != f_surname:
                intro += f" ({esc(s_maiden)})"
            intro += f" {esc(f_surname)}"
            if p.get("suffix") or sp.get("suffix"):
                # A shared surname would attach one parent's suffix to both.
                intro = f"Children of {esc(display_name(p))} and {esc(display_name(sp))}"
        # A missing date must not move a child to the end. Use the reviewed
        # family sequence if any child is undated. If all have a birth or
        # baptism year, retain chronological display; baptism order is qualified.
        def birth_year(k):
            date = k.get("birth_date") or next((b["date"] for b in k.get("baptisms", [])
                                               + k.get("christenings", []) if b["date"]), "")
            if re.match(r"^(?:BEF|AFT|BET|FROM|TO)\b", date):
                return None  # a bound or range does not supply a birth year
            m = re.search(r"\d{4}", date)
            return int(m.group(0)) if m else None
        dated_children = all(birth_year(k) is not None for k in kids)
        kids = sorted(kids, key=birth_year) if dated_children else list(kids)
        partial = len(kids) == 1
        intro_word = "Recorded child of" if partial else "Children of"
        intro = intro.replace("Children of", intro_word, 1)
        if not partial and not dated_children:
            intro += " (listed in recorded order)"
        elif not partial and any(not k.get("birth_date") and (k.get("baptisms") or k.get("christenings"))
                                 for k in kids):
            intro += " (ordered by recorded birth or baptism year; birth order uncertain)"
        items, segments = [], []
        continued_intro = intro + " (continued)"
        for i, k in enumerate(kids, start=1):
            if k["refn"] in getattr(self, "_child_breaks", set()):
                self._used_child_breaks.add(k["refn"])
                if items:
                    segments.append(f"#children([{intro}:], ({', '.join(items)},))")
                    items = []
                    intro = continued_intro
                segments.append('#pagebreak(weak: true)')
            kn = self.nums.get(k["xref"])
            vit = []

            def event(label, record, cite=True):
                # The date, else the place: an event with only a place keeps
                # it and its citations.
                detail = child_date(record["date"]) or record["place"]
                note = (self.fn(k["refn"], record["source_keys"], reg_no=a["ahnentafel"][0])
                        if kn is None and cite else "")
                if detail or note:
                    vit.append(label + (f" {esc(detail)}" if detail else "") + note)

            births, deaths = k.get("births", []), k.get("deaths", [])

            def primary(kind, events):
                # The printed birth or death, with the citations of that event only.
                return {"date": k.get(f"{kind}_date") or "", "place": k.get(f"{kind}_place") or "",
                        "source_keys": events[0]["source_keys"] if events else []}

            event("b.", primary("birth", births))
            for baptism in k.get("baptisms", []):
                vit.append("bp." + (f" {esc(child_date(baptism['date']) or baptism['place'])}"
                                    if baptism["date"] or baptism["place"] else "")
                           + (self.fn(k["refn"], baptism["source_keys"], reg_no=a["ahnentafel"][0])
                              if kn is None else ""))
            for christening in k.get("christenings", []):
                event("chr.", christening)
            if kn is None:
                for other in births[1:]:
                    event("also b.", other)
                event("d.", primary("death", deaths))
                for other in deaths[1:]:
                    event("also d.", other)
                for cremation in k.get("cremations", []):
                    event("crem.", cremation)
            if kn is None:
                for burial in k.get("burials", []):
                    label = {"recorded": "bur.", "reported": "burial reported",
                             "planned": "burial planned"}[burial["kind"]]
                    detail = burial["place"]
                    if burial["date"]:
                        detail += (", " if detail else "") + child_date(burial["date"])
                    note = self.fn(k["refn"], burial["source_keys"], reg_no=a["ahnentafel"][0])
                    vit.append(label + (" " + esc(detail) if detail else "") + note)
            # A bare semicolon after #footnote[...] terminates Typst code and
            # disappears. Escape it so the birth/death separator is printed.
            vit_s = r"\; ".join(vit)
            # An adopted or foster child is marked in that family's list.
            kind = next((CHILD_KINDS.get(link["kind"], "") for link in k.get("parent_families", [])
                         if link["family"] == family), "")
            if kind:
                vit_s = kind + (r"\; " + vit_s if vit_s else "")
            rn = "" if partial else roman(i)
            if kn:
                body = (f'#link(<reg-{k["refn"]}>)[#smallcaps[{esc(display_name(k))}]]'
                        + (f", {vit_s}" if vit_s else "") + ".")
                items.append(f'child-fwd("{kn[0]}", "{rn}", [{body}])')
            else:
                body = f"#smallcaps[{esc(display_name(k))}]" + (f", {vit_s}" if vit_s else "") + "."
                body += self.collateral_navigation(k)
                items.append(f'child-plain("{rn}", [{body}])')
                self.add_index(k, f"under {a['ahnentafel'][0]}")
        segments.append(f"#children([{intro}:], ({', '.join(items)},))")
        return "\n\n".join(segments)

    def vital_notes(self, p, reg_no):
        """Footnotes for each of a person's events, made in reading order:
        the first/full-source state of a citation depends on that order."""
        refn = p["refn"]
        births, deaths = p.get("births", []), p.get("deaths", [])
        notes = lambda events: [self.fn(refn, e["source_keys"], reg_no=reg_no) for e in events]
        return {"birth": "".join(notes(births[:1])), "baptisms": notes(p.get("baptisms", [])),
                "christenings": notes(p.get("christenings", [])),
                "death": "".join(notes(deaths[:1])), "cremations": notes(p.get("cremations", [])),
                "other_births": notes(births[1:]), "other_deaths": notes(deaths[1:]),
                "burials": notes(p.get("burials", []))}

    def vitals(self, p, notes=None, *, include_burials=True):
        """Guide, Manual (ancestor table): birth, baptism, death, burial; PLACE before date;
        'at' a town, 'in' a region. Per-fact footnotes attach to their clause
        (Guide ch. 5: the reader must see which source backs which fact).
        A second birth or death record follows as its own sentence, with its
        own notes, so a footnote never backs a fact it does not record."""
        notes = notes or {}
        name = display_name(p)
        bits = []

        def clause(verb, events, key):
            found = notes.get(key) or []
            for i, event in enumerate(events):
                bits.append(verb + where_and_when(event["place"], event["date"])
                            + (found[i] if i < len(found) else ""))

        # A birth or death with only a citation still prints, so its note
        # keeps a clause to stand on.
        if p.get("birth_date") or p.get("birth_place") or notes.get("birth"):
            bits.append("was born" + where_and_when(p.get("birth_place"), p.get("birth_date"))
                        + notes.get("birth", ""))
        clause("was baptized", p.get("baptisms", []), "baptisms")
        clause("was christened", p.get("christenings", []), "christenings")
        if p.get("death_date") or p.get("death_place") or notes.get("death"):
            bits.append("died" + where_and_when(p.get("death_place"), p.get("death_date"))
                        + notes.get("death", ""))
        clause("was cremated", p.get("cremations", []), "cremations")
        result = (f"*#smallcaps[{esc(name)}]* " + " and ".join(bits) + "." if bits
                  else f"*#smallcaps[{esc(name)}]*.{notes.get('birth', '')}{notes.get('death', '')}")
        for label, events, key in (("Birth", p.get("births", [])[1:], "other_births"),
                                   ("Death", p.get("deaths", [])[1:], "other_deaths")):
            found = notes.get(key) or []
            for i, event in enumerate(events):
                note = found[i] if i < len(found) else ""
                if event["place"] or event["date"] or note:
                    result += (f" {label} was also recorded"
                               + where_and_when(event["place"], event["date"]) + "." + note)
        if include_burials:
            for sentence in self.burial_sentences(p, notes.get("burials")):
                result += " " + sentence
        return result

    def burial_sentences(self, p, burial_fns=None):
        """Keep event semantics and citations identical across layout choices."""
        result = []
        for i, burial in enumerate(p.get("burials", [])):
            s = {"recorded": "Burial was recorded", "reported": "Burial is reported",
                 "planned": "Burial was planned"}[burial["kind"]]
            s += where_and_when(burial["place"], burial["date"])
            note = burial_fns[i] if burial_fns else ""
            result.append(s + "." + note)
        return result

    # ---------- back matter ----------

    def bibliography(self):
        out = ["= Bibliography <bibliography>", ""]
        out.append("#set par(first-line-indent: 0em)")
        policy = getattr(self, "bibliography_policy", {"schema": 1, "census_sources": []})
        omitted = bookbib.census_omissions(self.src_keys, policy)
        # Only a book that leaves its census schedules out says where they are.
        out.append("_Works and records cited in the narrative and Register, grouped "
                   "by source category."
                   + (" Census schedules are cited in the notes and Sources for the Register."
                      if omitted else "") + "_")
        out.append("")
        cited = {}
        for sources in self.src_keys.values():
            for rec in sources.values():
                if citation_identity(rec) in self.cited_uses:
                    cited.setdefault(bookbib.token(rec), rec)
        by_tier = {}
        for source, rec in cited.items():
            if source not in omitted:
                if rec["tier"] not in TIER_ORDER:
                    raise ValueError(f"unsupported bibliography tier: {rec['tier']!r}")
                by_tier.setdefault(rec["tier"], []).append((source, rec))
        last_tier = [t for t in TIER_ORDER if by_tier.get(t)][-1:]
        for tier in TIER_ORDER:
            recs = sorted(by_tier.get(tier, []),
                          key=lambda item: (item[1].get("source_label", item[1]["label"]).casefold(),
                                            item[0]))
            if not recs:
                continue
            out.append(f"== {TIER_HEADINGS[tier]}")
            out.append("")
            entries = []
            for source, rec in recs:
                entry = linked_source_label(rec.get("source_label", rec["label"]), rec.get("url"))
                entries.append(f'- {entry}#metadata("{source}") <bibliography-entry>')
            if [tier] == last_tier and len(entries) > BIBLIOGRAPHY_TAIL_ENTRIES:
                # The last entries travel together, so the bibliography never
                # ends with part of one entry alone on its last page. The gap
                # above matches the template's list leading.
                out.extend(entries[:-BIBLIOGRAPHY_TAIL_ENTRIES])
                out.append("#block(breakable: false, above: 0.68em)[")
                out.extend(entries[-BIBLIOGRAPHY_TAIL_ENTRIES:])
                out.append("]")
            else:
                out.extend(entries)
            out.append("")
        return "\n".join(out)

    def has_open_questions(self):
        """True when the front or back matter has a chapter called Open Questions."""
        return any(re.search(r"(?mi)^=\s+Open Questions\s*(?:<[^>]*>)?\s*$",
                             booklib.parse_front_matter(f)[1])
                   for folder in ("front-matter", "back-matter")
                   for f in booklib.typ_files(booklib.BOOK_DIR / folder))

    def root_person(self):
        """Ahnentafel no. 1, the person the book is about."""
        xref = getattr(self, "table", {}).get(1)
        return self.tree.by_xref.get(xref) if xref else None

    def root_first_name(self):
        """The root person's first given name, as the reader knows them."""
        given = ((self.root_person() or {}).get("given") or "").split()
        return given[0] if given else "The root person"

    def ahnentafel_table(self):
        """Guide, Manual: every number must be accounted for — unknown
        ancestors appear with their number and blank lines (research frontier)."""
        root = self.root_person()
        root_name = booklib.person_name(root) if root else "the family"
        where = "the Register entries and Open Questions" if self.has_open_questions() \
            else "the Register entries"
        out = [f"= Ahnentafel of {esc(root_name)} <ahnentafel>", ""]
        rows = []
        # An ancestor reached by more than one line prints in full under the
        # first number only (book.repeated_ancestors).
        shown, repeats = (booklib.first_appearances(self.table)
                          if booklib.repeated_ancestors_once() else (self.table, {}))

        def uncertain(p):
            # An estimated or bounded date, or a second record of a birth or death.
            events = [*p.get("births", []), *p.get("deaths", [])]
            return (len(p.get("births", [])) > 1 or len(p.get("deaths", [])) > 1 or any(
                re.match(r"\s*(ABT|EST|CAL|BEF|AFT|BET|FROM|TO|INT)\b", e.get("date") or "", re.I)
                for e in events))
        if any(uncertain(self.tree.by_xref[x]) for n, x in shown.items() if n not in repeats):
            out += [f"The table includes provisional and disputed dates. See {where} "
                    "for the evidence and alternatives.", ""]
        # An unknown parent of a repeat, or of someone above one, is not listed again.
        gaps = [g for g in self.cov.get("gaps", [])
                if g // 2 not in repeats and (g // 2 in shown or g // 2 not in self.table)]
        all_ns = sorted(set(shown) | set(gaps))
        for n in all_ns:
            xref = shown.get(n)
            if xref:
                p = self.tree.by_xref[xref]
                nm = esc(display_name(p))
                if p.get("refn"):
                    nm = f"#link(<reg-{p['refn']}>)[{nm}]"
                if n in repeats:
                    rows.append(f'  [{n}], [{nm}, see no.~{repeats[n]}], [], [],')
                    continue
                rows.append(f'  [{n}], [{nm}], [{esc(prose_date(p.get("birth_date") or ""))}], '
                            f'[{esc(prose_date(p.get("death_date") or ""))}],')
            else:
                rows.append(f'  [{n}], [#text(fill: rgb("#8A8D86"))[\\_\\_\\_\\_\\_ '
                            f'\\_\\_\\_\\_\\_]], [], [],')
        out.append("#set text(size: 9pt)")
        # Full date ranges must wrap inside their own columns. Auto date
        # widths can consume the name column and overprint its text.
        opts = ["  columns: (auto, 1.4fr, 1fr, 1fr),",
                "  stroke: 0.4pt + rgb(\"#B9B4A5\"),",
                "  inset: 4.5pt,"]
        # The last rows travel with the closing note, so the table never
        # ends with a row or two alone on a page.
        tail = rows[-AHNENTAFEL_TAIL_ROWS:]
        body = rows[:-AHNENTAFEL_TAIL_ROWS]
        if body:
            out.append("#table(")
            out.extend(opts)
            out.append("  table.header([*no.*], [*person*], [*born*], [*died*]),")
            out.extend(body)
            out.append(")")
        out.append("#block(breakable: false, above: 0pt)[")
        out.append("#table(")
        out.extend(opts)
        if not body:
            out.append("  table.header([*no.*], [*person*], [*born*], [*died*]),")
        out.extend(tail)
        out.append(")")
        out.append("")
        out.append("_Blank lines mark ancestors not yet identified — the research frontier._"
                   + (" _Someone reached by more than one line is listed in full once; "
                      "their later numbers say where._" if repeats else ""))
        out.append("]")
        out.append("")
        return "\n".join(out)

    def _augment_index_married_names(self):
        """Cross-reference indexed women through their recorded family links.

        A surname cross-reference is a finding aid, not evidence of name usage.
        """
        for xref, tags in getattr(self, "indexed_people", {}).items():
            p = self.tree.by_xref[xref]
            if p.get("sex") == "M":
                continue
            maiden, given = booklib.index_name(p)
            if not tags:
                continue
            for fam in self.tree.spouse_families(p["xref"]):
                hub = self.tree.by_xref.get(fam["husb"])
                if not hub:
                    continue
                h_surname = (hub.get("surname") or "").strip()
                if not h_surname or h_surname == maiden:
                    continue
                married_given = f"{given} ({maiden})" if maiden else given
                self.index.setdefault((h_surname, married_given), set()).update(tags)

    def name_index(self):
        self._augment_index_married_names()
        # map for boldfacing a person's own (primary) number — Guide ch. 10
        own = {}
        for n, xref in self.table.items():
            p = self.tree.by_xref[xref]
            key = booklib.index_name(p)
            own.setdefault(key, set()).add(str(n))
            for name in p.get("alternate_names", []):
                alias = booklib.index_name(name)
                if any(alias):
                    own.setdefault(alias, set()).add(str(n))
        out = ["= Index of Names <index>", ""]
        out.append("#set par(first-line-indent: 0em)")
        out.append("_References are Register numbers, not page numbers. *Boldface* marks "
                   "the person's own Register entry; \"under N\" locates a relative within "
                   "that entry or its family continuations. Recorded alternate names "
                   "are also indexed. Additional surname cross-references follow "
                   "recorded family links; those do not establish name usage._")
        out.append("")
        out.append("#columns(2, gutter: 1.4em)[")
        out.append("#set text(size: 8.8pt)")
        # People with no recorded surname come first, by given name. The rest
        # file under the letter their surname folds to: Ó'Brien under O.
        entries = sorted(((key, tags) for key, tags in self.index.items() if any(key)),
                         key=lambda kv: (bool(kv[0][0]), index_sort_key(kv[0][0]),
                                         index_sort_key(kv[0][1])))
        cur = None
        for (surname, given), tags in entries:
            letter = index_sort_key(surname)[:1].upper() if surname else "Surname not recorded"
            first_in_letter = letter != cur
            if first_in_letter:
                # A line of text has no height below its baseline, so the
                # letter needs space above it or it prints over the entry above.
                out.append('#block(breakable: false, above: 1.1em, below: auto)[')
                out.append(f"*{esc(letter)}* \\")
                cur = letter
            # a married-name entry "Edith (Rowe)" boldfaces via the maiden key
            m = re.match(r"^(.*) \((.+)\)$", given)
            key = ((m.group(2), m.group(1)) if m else (surname, given))
            bold = own.get(key, set())
            rendered = [f"*{t}*" if t in bold else t
                        for t in sorted(tags, key=lambda t: (len(t), t))]
            name = f"{esc(surname)}, {esc(given)}" if surname and given else esc(surname or given)
            out.append(f"{name} — {', '.join(rendered)} \\")
            if first_in_letter:
                out.append(']')
        out.append("]")
        out.append("")
        return "\n".join(out)

    # ---------- assembly ----------

    def assemble(self):
        cfg = self.cfg
        parts = []
        parts.append(f'#import "{booklib.TEMPLATE_IMPORT}": *')
        parts.append("")
        parts.append(f'#show: book.with(title: "{esc_str(cfg.get("title", ""))}", '
                     f'author: "{esc_str(cfg.get("author", ""))}")')
        parts.append("")
        parts.append(f'#title-page(strapline: "{esc_str(booklib.strapline(cfg))}", '
                     f'title: "{esc_str(cfg.get("title", ""))}", '
                     f'subtitle: "{esc_str(cfg.get("subtitle", ""))}", '
                     f'author: "{esc_str(cfg.get("author", ""))}", '
                     f'stamp: "{build_clock.today().strftime("%B %Y")} edition — '
                     f'{len(self.cov["ancestors"])} people in the ancestor table")')
        parts.append("")
        parts.append("#outline(depth: 2, indent: 1em)")
        parts.append("")
        # front-matter essays
        fm_dir = booklib.BOOK_DIR / "front-matter"
        if fm_dir.exists():
            for f in booklib.typ_files(fm_dir):
                _, body = booklib.parse_front_matter(f)
                body = body.replace("{{stat:persons}}", str(len(self.cov["ancestors"])))
                body = body.replace("{{stat:date}}", booklib.edition_date(build_clock.today()))
                parts.append(self.process_prose(body, list(self.cov["ancestors"]), f.name))
                parts.append("")
        # Mark the parity gap before the numbering rule starts a new page.
        parts.append('#recto-break()')
        # body switches from roman front-matter folios to arabic, restarting at 1
        parts.append('#set page(numbering: "1")')
        parts.append('#part-page("Part I", "The Narrative", restart: true)')
        parts.append("")
        parts.append(self.narrative())
        parts.append("")
        parts.append('#part-page("Part II", "The Genealogical Register")')
        parts.append("")
        parts.append(self.register())
        parts.append("")
        # hand-written back-matter (Open Questions, Afterword) renders after
        # the register but BEFORE the reference apparatus — the index is
        # always the last thing in the book (standard print convention)
        bm_dir = booklib.BOOK_DIR / "back-matter"
        if bm_dir.exists():
            for f in booklib.typ_files(bm_dir):
                _, body = booklib.parse_front_matter(f)
                parts.append(self.process_prose(body, list(self.cov["ancestors"]), f.name))
                parts.append("")
        parts.append(self.register_references())
        parts.append("")
        parts.append(self.bibliography())
        parts.append("")
        parts.append(self.ahnentafel_table())
        parts.append("")
        parts.append(self.name_index())
        parts.append("")
        return "\n".join(parts) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(BUILD / "book.typ"))
    ap.add_argument("--sources", metavar="REFN", help="list citation keys for a person and exit")
    args = ap.parse_args()

    asm = Assembler()

    if args.sources:
        keys = asm.src_keys.get(args.sources)
        if keys is None:
            sys.exit(f"No one in the tree has the id {args.sources!r}.")
        if not keys:
            print(f"{args.sources} cites no sources yet, so a story about them has nothing "
                  "to cite. Add a citation to the tree first; docs/book.md, \"When flyleaf "
                  "sources lists nothing\", says how.")
            return
        print(f'citation keys for {args.sources} (use as #src("<key>")):')
        for k, rec in keys.items():
            print(f"  {k:<50} [{rec['tier']}] {rec['label'][:70]}")
        return

    if asm.cov["errors"]:
        for e in asm.cov["errors"]:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit("book-assemble: refusing to build while coverage has errors")

    # all lint classes travel with every build (see docs/book.md)
    import re as _re
    for w in asm.cov["warns"]:
        if _re.search(r": [LG]\d+ |^G\d+ ", w):
            print(f"cite-lint: {w}", file=sys.stderr)
    # The book prints every fact the tree holds, about the living too.
    living = sorted(booklib.person_name(asm.tree.by_xref[x])
                    for x in booklib.possibly_living(asm.tree) if x in asm.tree.by_xref)
    if living:
        print(f"note: the book names {len(living)} {'person' if len(living) == 1 else 'people'} "
              f"who may be living, with every fact the tree holds about them, such as "
              f"{', '.join(living[:3])}. Keep in the tree only what you would print "
              "(docs/relatives.md, \"What to publish about living people\").", file=sys.stderr)

    BUILD.mkdir(exist_ok=True)
    text = asm.assemble()
    Path(args.out).write_text(text, encoding="utf-8")
    for w in asm.warnings:
        print(f"warn: {w}", file=sys.stderr)
    if not booklib.flyleaf_settings.get("book.fonts"):
        lacking = booklib.letters_the_fonts_lack(
            f"{p.get('given') or ''} {p.get('surname') or ''}" for p in asm.tree.by_xref.values())
        if lacking:
            print("warn: names in the tree use letters the book's fonts do not have, such as "
                  f"{''.join(sorted(lacking)[:5])}. They print as empty boxes. Name fonts that "
                  "have them in book.fonts in flyleaf.json (docs/book.md).", file=sys.stderr)
    # unresolved citations/figures silently drop footnotes from the built book —
    # fatal, same policy as coverage errors (renaming a [Source] label renames
    # its slug; prose must be updated in the same change)
    fatal = [w for w in asm.warnings
             if "matches no source" in w or "not found" in w or "unknown refn" in w]
    if fatal:
        sys.exit(f"book-assemble: {len(fatal)} unresolved citation/figure/ref "
                 f"reference(s) — fix the #src/#fig/#refp keys above")
    print(f"assembled {args.out} ({len(text)//1000}k chars, {len(asm.index)} index names)")


if __name__ == "__main__":
    main()
