#!/usr/bin/env python3
"""Generate a personalized family questionnaire from the GEDCOM.

For a given person (REFN), emits questionnaires/questionnaire-<refn>.md:
  1. The required publication notice (Guide ch. 4).
  2. "What the records already say" — prefilled facts about the person, their
     parents, grandparents, and siblings, presented FOR CORRECTION: reading
     the record often brings back a memory. Other people who may be living
     are named without their facts.
  3. "Questions only you can answer" — sentences in their own and their
     ancestors' notes (3 generations) marked [TODO], TODO:, OPEN: or
     INVESTIGATE NEXT: (optional markers; docs/gedcom.md), plus the unknown
     parents on their line.
  4. The standing memory questions (Guide ch. 14 + Appendix B).
  5. Photos & papers request.

Usage: flyleaf questionnaire PERSON
       book-questionnaire.py REFN [REFN ...]
"""
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import booklib  # noqa: E402
import flyleaf_settings  # noqa: E402

OUT_DIR = booklib.ROOT / "questionnaires"
TODO_RE = re.compile(r"(?:\[TODO\]|TODO:|OPEN:|INVESTIGATE NEXT:|needs research|"
                     r"not yet (?:found|determined|known|identified))", re.IGNORECASE)


MONTHS = {"JAN":"January","FEB":"February","MAR":"March","APR":"April","MAY":"May",
          "JUN":"June","JUL":"July","AUG":"August","SEP":"September","OCT":"October",
          "NOV":"November","DEC":"December"}


def nice_date(s):
    if not s:
        return s
    out, calendar = booklib.calendar(s)
    for a, f in MONTHS.items():
        out = re.sub(rf"\b{a}\b", f, out)
    out = re.sub(r"\bABT\b\.?", "about", out)
    out = re.sub(r"\bBEF\b\.?", "before", out)
    out = re.sub(r"\bAFT\b\.?", "after", out)
    return out + (f" ({calendar})" if calendar else "")


def fact_line(p, tree, living=frozenset()):
    """What the records say about one person. A person in `living` (who may
    still be alive) is named without their facts."""
    if p["xref"] in living:
        return "(may be living: facts not shown here)"
    bits = []
    if p.get("birth_date") or p.get("birth_place"):
        bits.append("born " + " ".join(x for x in (nice_date(p.get("birth_date")),
                     ("at " + p["birth_place"]) if p.get("birth_place") else None) if x))
    if p.get("death_date") or p.get("death_place"):
        bits.append("died " + " ".join(x for x in (nice_date(p.get("death_date")),
                     ("at " + p["death_place"]) if p.get("death_place") else None) if x))
    seen_sp = set()
    for fam in tree.spouse_families(p["xref"]):
        sp_x = fam["wife"] if fam["husb"] == p["xref"] else fam["husb"]
        sp = tree.by_xref.get(sp_x)
        if sp and sp_x not in seen_sp:
            seen_sp.add(sp_x)
            name = f"{sp.get('given') or ''} {sp.get('surname') or ''}".strip()
            # A family record links partners; only a marriage event says they married.
            if fam.get("marr_recorded"):
                m = "married " + name
                # A marriage date is a fact about a partner who may be living too.
                if fam.get("marr_date") and sp_x not in living:
                    m += f" ({nice_date(fam['marr_date'])})"
            else:
                m = "partner of " + name
            bits.append(m)
    return "; ".join(bits) if bits else "(no vital facts recorded yet)"


def harvest_questions(p):
    """Pull open-question sentences out of a person's bio/notes."""
    out = []
    text = " ".join(x for x in (p.get("bio"), p.get("notes")) if x)
    for sent in re.split(r"(?<=[.!?])\s+", text):
        if TODO_RE.search(sent):
            s = re.sub(r"\[(?:TODO|NEGATIVE)\]\s*", "", sent).strip()
            s = re.sub(r"^(?:OPEN|INVESTIGATE NEXT):\s*", "", s)
            if 15 < len(s) < 300:
                out.append(s)
    return out


def ancestors_within(tree, xref, gens):
    """(xref, depth) for ancestors up to `gens` generations (incl. self at 0)."""
    out, frontier = [(xref, 0)], [(xref, 0)]
    while frontier:
        x, d = frontier.pop()
        if d >= gens:
            continue
        f, m = tree.parents_of(x)
        for px in (f, m):
            if px:
                out.append((px, d + 1))
                frontier.append((px, d + 1))
    return out


def _nm(p):
    return f"{p.get('given') or ''} {p.get('surname') or ''}".strip()


def memory_blocks(tree, p):
    """Story-eliciting question blocks (StoryCorps Great Questions + OHA/UCSC
    oral-history practice). Design rules: open stems
    ("Tell me about…", never yes/no); every question anchored to a concrete
    day/place/person/object from the GEDCOM where one exists; 2–3 follow-up
    probes each (probes are where stories live); blocks ordered easy→hard,
    triumphs before losses; a sensory and an emotional question per block;
    the StoryCorps legacy pair closes."""
    first = (p.get("given") or "").split()[0] if p.get("given") else "you"
    birthplace = (p.get("birth_place") or "").split(",")[0].strip()

    # concrete anchors from the tree
    def _year(s):
        m = re.search(r"\d{4}", s or "")
        return int(m.group(0)) if m else None

    p_born = _year(p.get("birth_date"))
    f_x, m_x = tree.parents_of(p["xref"])
    grands, grands_unmet = [], []
    for x in (f_x, m_x):
        if x:
            for gx in tree.parents_of(x):
                if gx:
                    g = tree.by_xref[gx]
                    g_died = _year(g.get("death_date"))
                    # only ask for firsthand memories of grandparents whose
                    # lifetime overlapped the respondent's
                    if p_born and g_died and g_died < p_born:
                        grands_unmet.append(_nm(g))
                    else:
                        grands.append(_nm(g))
    spouse_names = []
    for fam in tree.spouse_families(p["xref"]):
        sp_x = fam["wife"] if fam["husb"] == p["xref"] else fam["husb"]
        sp = tree.by_xref.get(sp_x)
        if sp:
            spouse_names.append(_nm(sp))

    probes_more = ["Tell me more — what happened next?",
                   "Why do you think that was?"]

    blocks = []

    # 1 — earliest world (easy, sensory-rich)
    home_q = (f"Describe the house you grew up in"
              + (f" around {birthplace}" if birthplace else "") + ".")
    blocks.append(("Your earliest world", [
        ("What is your earliest memory?",
         ["Where were you standing? Who else was there?",
          "What could you hear or smell?"]),
        (home_q,
         ["Walk me through the front door — what did you see first?",
          "What did the kitchen smell like?",
          "Where did people actually sit in the evenings?"]),
        ("Tell me about a perfectly ordinary weekday when you were about ten.",
         ["Who woke you? What was on the table?",
          "What part of that routine do you miss?"]),
    ]))

    # 2 — the people (anchored to named grandparents/parents)
    people = []
    for gname in grands[:4]:
        people.append((f"Tell me about {gname} — start with their voice.",
                       ["What is a thing they always said?",
                        "Describe one specific time you were alone with them.",
                        "What did their hands look like?"]))
    if not people:
        people.append(("Tell me about the oldest relative you remember clearly.",
                       ["What is a thing they always said?",
                        "Describe one specific time you were alone with them."]))
    for gname in grands_unmet[:2]:
        people.append((f"{gname} died before you were born — what were you told about them, and by whom?",
                       ["Is there a story about them the family still repeats?"]))
    people.append(("Who has been the biggest influence on your life? What did they teach you?",
                   ["Tell me about the day you understood that lesson."]))
    people.append(("Family stories you heard growing up — true or doubtful, tell them anyway.",
                   ["Who told it best? Where would they tell it?",
                    "Which one do you suspect grew in the telling?"]))
    blocks.append(("The people", people))

    # 3 — work & choices (contingency: decisions with stakes)
    blocks.append(("Work and choices", [
        ("Tell me about your first real job — the first day of it.",
         ["Who taught you the ropes? What surprised you?"]),
        ("What is a decision that changed the course of your life — a move, a job, a chance taken or not?",
         ["What were the options as you saw them at the time?",
          "What would have happened if you'd chosen the other way?"]),
        ("What did your parents do for a living, as YOU saw it as a child?",
         ["Did you ever visit them at work? Describe it."]),
    ]))

    # 4 — love & family (anchored to spouse where known)
    love = []
    for sname in spouse_names[:2]:
        love.append((f"Tell me about the day you met {sname}.",
                     ["What did you notice first?",
                      "When did you know? Tell me about that moment."]))
    if not love:
        love.append(("For each couple you knew personally — how did they meet?",
                     ["Who told you that story, and how did they tell it?"]))
    love.append(("What did this family ALWAYS do — holidays, reunions, Sunday dinners?",
                 ["Pick one specific year of it and describe that day.",
                  "What dish or ritual would cause a rebellion if it were skipped?"]))
    blocks.append(("Love and family", love))

    # 5 — the harder years (after triumphs, per sequencing practice)
    blocks.append(("The harder years", [
        ("What was the hardest season of your life, and what carried you through it?",
         ["Who showed up for you? What did they actually do?"]),
        ("Is there someone you lost whom you still talk to in your head?",
         ["What would you tell them today?"]),
    ]))

    # 6 — things & places (provenance hunting, sensory)
    blocks.append(("Things and places", [
        ("Who kept the family's things? Bibles, letters, diaries, albums, scrapbooks — where are they now?",
         ["Pick one object and tell me its story — who owned it first?"]),
        ("The places: the farm, the church, the summer house, the old neighborhood — which mattered most?",
         ["Take me there on its best day. What's happening around you?"]),
    ]))

    # 7 — legacy closers (StoryCorps signature pair + the closer)
    blocks.append(("For the record", [
        ("How would you like to be remembered?", probes_more[:1]),
        ("For the generations reading this book years from now: what wisdom would you pass on?",
         ["What do you know now that you wish you'd known at twenty?"]),
        ("Is there anything you've never been asked about this family that you want on the record?",
         []),
    ]))
    return blocks


def generate(tree, refn):
    p = tree.by_refn.get(refn)
    if not p:
        sys.exit(f"No one in the tree has the id {refn!r}. The ids are in the tree's REFN "
                 "lines, and flyleaf sources PERSON lists a person's sources.")
    name = f"{p.get('given') or ''} {p.get('surname') or ''}".strip()
    today = date.today().strftime("%B %Y")

    L = []
    L.append(f"# Family questionnaire — for {name}")
    L.append("")
    L.append(f"Prepared {today} for the family history "
             f"“{booklib.load_book_yaml().get('title', 'our family')}”. "
             f"Please note: what you share may be published in the book and on "
             f"the family's website, so share only what you're comfortable seeing "
             f"in print. Tell us about anything, especially about a living person, "
             f"that should stay out of it. Skip anything you like; ramble "
             f"anywhere you like — the stories matter as much as the dates.")
    L.append("")

    # ----- Section 1: the record, for correction -----
    L.append("## 1. What our records already say — please correct or confirm")
    L.append("")
    L.append("Reading the record often shakes loose a memory. Mark anything "
             "wrong, and add anything missing (dates, places, middle names).")
    L.append("")
    # The person the form is for sees their own record in full, to correct it.
    living = booklib.possibly_living(tree) - {p["xref"]}
    L.append(f"**You** — {name}: {fact_line(p, tree)}")
    f_x, m_x = tree.parents_of(p["xref"])
    for label, x in (("Your father", f_x), ("Your mother", m_x)):
        if x:
            pp = tree.by_xref[x]
            nm = f"{pp.get('given') or ''} {pp.get('surname') or ''}".strip()
            L.append(f"**{label}** — {nm}: {fact_line(pp, tree, living)}")
            gf, gm = tree.parents_of(x)
            for glabel, gx in ((f"{label}'s father", gf), (f"{label}'s mother", gm)):
                if gx:
                    gp = tree.by_xref[gx]
                    gnm = f"{gp.get('given') or ''} {gp.get('surname') or ''}".strip()
                    L.append(f"**{glabel}** — {gnm}: {fact_line(gp, tree, living)}")
                else:
                    L.append(f"**{glabel}** — _unknown to our records: can you name them?_")
    # siblings
    if p.get("famc"):
        fam = tree.fams.get(p["famc"])
        if fam:
            sibs = [tree.by_xref[c] for c in fam["chil"]
                    if c in tree.by_xref and c != p["xref"]]
            if sibs:
                names = ", ".join(f"{s.get('given') or ''} {s.get('surname') or ''}".strip()
                                  for s in sibs)
                L.append(f"**Your siblings** (per our records): {names}")
    L.append("")

    # ----- Section 2: memory questions (before the hard research items —
    # oral-history practice: start easy and enjoyable, let the narrator run) -----
    L.append("## 2. The memory questions — please ramble")
    L.append("")
    L.append("*These are meant to be answered out loud as much as on paper — "
             "have someone read them to you if that's easier, and don't stop "
             "at the first sentence: the follow-ups under each question are "
             "where the stories live.*")
    L.append("")
    for header, items in memory_blocks(tree, p):
        L.append(f"**{header}**")
        L.append("")
        for q, probes in items:
            L.append(f"- {q}")
            for pr in probes:
                L.append(f"    - *{pr}*")
        L.append("")

    # ----- Section 3: harvested open questions -----
    L.append("## 3. Questions only you may be able to answer")
    L.append("")
    seen = set()
    n = 0
    for x, depth in ancestors_within(tree, p["xref"], 3):
        # Research notes about someone else who may be living stay private.
        if x in living:
            continue
        pp = tree.by_xref[x]
        nm = f"{pp.get('given') or ''} {pp.get('surname') or ''}".strip()
        for q in harvest_questions(pp):
            key = q[:60]
            if key in seen:
                continue
            seen.add(key)
            n += 1
            who = "you" if depth == 0 else nm
            L.append(f"{n}. *(re: {who})* {q}")
    # Unknown parents of the person's parents and grandparents. A person who
    # appears twice (cousins who married) is asked about once.
    asked = set()
    for x, depth in ancestors_within(tree, p["xref"], 2):
        f, m = tree.parents_of(x)
        pp = tree.by_xref[x]
        nm = f"{pp.get('given') or ''} {pp.get('surname') or ''}".strip()
        if depth > 0 and (f is None or m is None) and x not in asked:
            asked.add(x)
            missing = []
            if f is None:
                missing.append("father")
            if m is None:
                missing.append("mother")
            n += 1
            L.append(f"{n}. Our records do not name {nm}'s {' or '.join(missing)} — "
                     f"do you know anything about them, however small?")
    if n == 0:
        L.append("_(No specific open questions on your immediate lines — "
                 "the memory questions in section 2 are the heart of this one.)_")
    L.append("")

    # ----- Section 4: photos & papers -----
    L.append("## 4. Photographs and papers")
    L.append("")
    L.append("May we scan (or receive scans of) family photos, certificates, "
             "letters, clippings? 300 dpi in color is ideal — we can do the "
             "scanning. An emailed OK to publish is all we need; every image "
             "is credited in the book.")
    L.append("")
    L.append(f"*Return to: {flyleaf_settings.require('maintainer.name')}. Thank you — every answer makes the book truer.*")
    L.append("")

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / f"questionnaire-{refn}.md"
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"→ {out.relative_to(booklib.ROOT)}  ({n} open question{'' if n == 1 else 's'} from the tree)")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: book-questionnaire.py REFN [REFN ...]")
    tree = booklib.Tree()
    for refn in sys.argv[1:]:
        generate(tree, refn)


if __name__ == "__main__":
    main()
