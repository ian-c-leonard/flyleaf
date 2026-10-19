"""Check explicit citation display metadata against its exact Book evidence.

No generated biographies, note paraphrases or source guessing. Canonical HTML,
notes and source records are never mutated by this presentation projection.
Optional: used only for citationPresentation in book/web-selections.json.
"""
from copy import deepcopy
import re
from website_book_annotations import content_digest, normalized, require

HASH = re.compile(r'[a-f0-9]{64}')
EMAIL = re.compile(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}')
FIELDS = {'person', 'key', 'contextSha256', 'title', 'context', 'qualifications', 'preferredFile', 'preferredPdfPage'}


def citation_note_texts(body, citation):
    """Unique exact note contexts; repetition, anchor and marker changes are cosmetic."""
    identity = (citation['person'], citation['key'])
    notes = set()
    for note in body.nodes():
        if 'data-book-note' not in note.attrs:
            continue
        owners = {(node.attrs.get('data-book-person'), node.attrs.get('data-book-key'))
                  for node in note.nodes() if 'data-book-person' in node.attrs}
        if identity in owners:
            notes.add(normalized(note.text({'doc-backlink'})))
    require(notes and all(notes), 'Citation display has no exact attached Book note')
    return sorted(notes)


def citation_context(body, citation):
    # Files/locators describe a set of endpoints; their emitted ordering is not meaning.
    source = deepcopy(citation)
    for field in ('legacyNotes', 'locators', 'files'):
        source[field] = sorted(set(source[field]))
    return {'citation': source, 'notes': citation_note_texts(body, citation)}


def citation_presentation_selector(body, citation, **display):
    """Draft a pinned selector for deliberate editorial review, never auto-adopt it."""
    return {'person': citation['person'], 'key': citation['key'],
            'contextSha256': content_digest(citation_context(body, citation)), **display}


def build_citation_presentation(body, citations, selections, admitted):
    require(isinstance(selections, list), 'Citation presentation must be a list')
    by_identity = {(c['person'], c['key']): c for c in citations}
    require(len(by_identity) == len(citations), 'Citation presentation cannot select ambiguous source keys')
    seen, result = set(), []
    for entry in selections:
        require(isinstance(entry, dict) and not (set(entry) - FIELDS) and
                (FIELDS - {'preferredFile', 'preferredPdfPage'}).issubset(entry), 'Unsupported citation presentation selector')
        require(isinstance(entry['person'], str) and entry['person'] and
                isinstance(entry['key'], str) and entry['key'], 'Invalid citation presentation owner/key')
        identity = (entry['person'], entry['key'])
        require(identity in by_identity and identity not in seen, 'Missing or duplicate citation presentation use')
        seen.add(identity)
        citation = by_identity[identity]
        actual = citation_context(body, citation)
        require(isinstance(entry['contextSha256'], str) and HASH.fullmatch(entry['contextSha256']) and
                entry['contextSha256'] == content_digest(actual), 'Citation presentation wording/source context changed')
        for key, limit in (('title', 640), ('context', 1600)):
            value = entry[key]
            require(isinstance(value, str) and value.strip() and len(value) <= limit and not EMAIL.search(value),
                    'Citation display text is empty, too long or contains a contact address')
        require(isinstance(entry['qualifications'], list) and len(entry['qualifications']) <= 8 and
                all(isinstance(q, str) and q.strip() and len(q) <= 1200 and not EMAIL.search(q)
                    for q in entry['qualifications']), 'Invalid citation display qualifications')
        require(not any(EMAIL.search(note) for note in actual['notes']),
                'Canonical public note contains a contact address; revise the authored note before publication')
        if 'preferredFile' in entry:
            require(isinstance(entry['preferredFile'], str) and entry['preferredFile'] in citation['files'] and
                    entry['preferredFile'] in admitted, 'Preferred citation file is not an exact admitted endpoint')
        if 'preferredPdfPage' in entry:
            require(type(entry['preferredPdfPage']) is int and
                    1 <= entry['preferredPdfPage'] <= 9007199254740991 and
                    isinstance(entry.get('preferredFile'), str) and
                    entry['preferredFile'].lower().endswith('.pdf'),
                    'Preferred physical PDF page requires a positive safe integer and its exact PDF endpoint')
        result.append(deepcopy(entry))
    return result
