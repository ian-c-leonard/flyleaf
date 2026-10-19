"""Sort a source into an evidence tier: one classifier for checking the tree
(validate-gedcom.py) and for building the book (booklib.py).

A source's _TIER, when it has one, decides. Otherwise its title and its web
addresses are matched against patterns, tier by tier, best first. The
built-in patterns below name general kinds of record, in several languages.
A family adds its own (an archive it uses, a book it relies on) in the file
named by paths.source_tier_patterns in flyleaf.json:

  {"patterns": {"primary": ["\\bExample County Deeds\\b"], "lead": ["example\\.org"]}}

A family's patterns are tried first, so they decide for the sources they
name. With "general_patterns": false in that file, only the family's
patterns are used. See docs/research-standards.md.
"""
import json
import re

import flyleaf_settings

SOURCE_TIERS = ("primary", "authoritative-secondary", "compiled-secondary",
                "family-testimony", "lead", "unclassified")

# Records made at the time of the event, by the people or offices who kept them.
PRIMARY_PATTERNS = [
    r"\b(?:birth|death|marriage|baptism|burial) certificates?\b",
    r"\bcivil regist(?:er|ers|ry|ration)\b",
    r"\bstatutory registers?\b",
    r"\b(?:parish|church) (?:registers?|records?|books?)\b",
    r"\bcensus\b",
    r"\bwill of\b",
    r"\blast will\b",
    r"\bprobate\b",
    r"\bpassenger (?:lists?|manifests?)\b",
    r"\bship'?s? manifests?\b",
    r"\bmilitary (?:service )?records?\b",
    r"\bservice records?\b",
    r"\bpension (?:files?|applications?|records?)\b",
    r"\bmuster rolls?\b",
    r"\bdraft registrations?\b",
    r"\bnaturali[sz]ation\b",
    # The same kinds in other languages: German, Dutch, Scandinavian, French,
    # Spanish, Italian and Portuguese.
    r"\bkirchenb(?:uch|ücher)\b",
    r"\bstandesamt\b",
    r"\bpersonenstandsregister\b",
    r"\bdoop(?:boek|register)\b",
    r"\bburgerlijke stand\b",
    r"\bkyrkb(?:ok|öcker)\b",
    r"\bkirkebo[gk]\b",
    r"\bhusförhörslängd\b",
    r"\bétat civil\b",
    r"\bregistres? paroissia(?:l|ux)\b",
    r"\bregistro (?:civil|parroquial)\b",
    r"\blibro de (?:bautismos|matrimonios|defunciones)\b",
    r"\bregistri parrocchiali\b",
    r"\bregisto (?:civil|paroquial)\b",
]

# Published, edited work on original records by an official or scholarly
# body. No general pattern tells these apart; a family names the ones it uses.
AUTHORITATIVE_SECONDARY_PATTERNS = []

# Compiled from other sources: newspapers, obituaries, histories, directories.
COMPILED_SECONDARY_PATTERNS = [
    r"\bnewspapers?\b",
    r"\bobituar(?:y|ies)\b",
    r"\b(?:county|town|city|local|family) histor(?:y|ies)\b",
    r"\bhistor(?:y|ies) of (?:the )?[\w.' -]+? (?:county|parish|town|township|city)\b",
    r"\bbiographical (?:dictionary|encyclopedia|sketch(?:es)?)\b",
    r"\b(?:city|town|county|trade|commercial|street) director(?:y|ies)\b",
]

# What the family itself holds or remembers.
FAMILY_TESTIMONY_PATTERNS = [
    r"\bfamily (?:knowledge|memoir|bible|papers)\b",
    r"\boral history\b",
    r"\bquestionnaire supplied\b",
    r"\binterview by\b",
]

# Online trees and other collaborative databases: places to look, not proof.
LEAD_PATTERNS = [
    r"wikitree\.com", r"\bWikiTree\b",
    r"geni\.com", r"\bGeni\b",
    r"ancestry\.[a-z.]+/family-tree", r"\bmember trees?\b", r"\bonline (?:family )?trees?\b",
    r"familysearch\.org/tree\b",
    r"myheritage\.[a-z.]+",
    r"findagrave\.com", r"\bFind a Grave\b",
    r"billiongraves\.com",
    r"rootsweb",
    r"genealogy\.com",
    r"wikipedia\.org",
]

# An index or an abstract is compiled from the records it names: a "census
# index" is not the census. The general rules check these first.
DERIVED_PATTERNS = [r"\bindex(?:es)?\b", r"\babstracts?\b"]

GENERAL = {"primary": PRIMARY_PATTERNS, "authoritative-secondary": AUTHORITATIVE_SECONDARY_PATTERNS,
           "compiled-secondary": COMPILED_SECONDARY_PATTERNS,
           "family-testimony": FAMILY_TESTIMONY_PATTERNS, "lead": LEAD_PATTERNS}


def family_patterns():
    """The family's own patterns (paths.source_tier_patterns), by tier, and
    whether the general patterns are used too."""
    name = flyleaf_settings.get("paths.source_tier_patterns")
    if not name:
        return {}, True
    rules = json.loads((flyleaf_settings.family_root() / name).read_text())
    unknown = sorted(set(rules.get("patterns", {})) - set(GENERAL))
    if unknown:
        raise SystemExit(f"{name}: unknown tier {unknown[0]!r}; use one of " + ", ".join(GENERAL))
    general = rules.get("general_patterns", True)
    if not isinstance(general, bool):
        raise SystemExit(f"{name}: general_patterns must be true or false")
    return rules.get("patterns", {}), general


_FAMILY, _USE_GENERAL = family_patterns()
# The family's patterns first, then the general ones: each list tier by tier.
_RULES = [_FAMILY] + ([GENERAL] if _USE_GENERAL else [])


def classify_source(text, curated_tier=None):
    """Return one of SOURCE_TIERS for a source's text (see source_text)."""
    if curated_tier:
        if curated_tier not in SOURCE_TIERS:
            raise ValueError(f"invalid source _TIER {curated_tier!r}")
        return curated_tier
    t = (text or "").strip()
    for rules in _RULES:
        if rules is GENERAL and any(re.search(p, t, re.IGNORECASE) for p in DERIVED_PATTERNS):
            return "compiled-secondary"
        for tier in SOURCE_TIERS[:-1]:
            if any(re.search(pattern, t, re.IGNORECASE) for pattern in rules.get(tier, [])):
                return tier
    return "unclassified"


def source_text(title, addresses=()):
    """What a source is classified by: its title, then its web addresses."""
    return " ".join([title or "", *[a for a in addresses if a]]).strip()


def record_text(source):
    """The classification text of a GEDCOM SOUR record: its title (else its
    short title or author), its _URL, and the addresses in its repository
    call numbers and notes."""
    def text(element):
        return element.get_multi_line_value() or ""

    title = next((text(c) for tag in ("TITL", "ABBR", "AUTH")
                  for c in source.get_child_elements() if c.get_tag() == tag and text(c)), "")
    addresses = []
    for child in source.get_child_elements():
        if child.get_tag() == "_URL":
            addresses.append(text(child))
        elif child.get_tag() == "REPO":
            addresses += [text(c) for c in child.get_child_elements() if c.get_tag() == "CALN"]
        elif child.get_tag() == "NOTE" and re.search(r"https?://", text(child)):
            addresses.append(text(child))
    return source_text(title, addresses)
