# What Flyleaf reads from a GEDCOM

Flyleaf reads GEDCOM 5.5.1, the format most genealogy programs export, and
the older 5.5. It has been tested with exports from Gramps and from PAF. It
reads the standard records as they are. A few extra tags, all starting with
an underscore, hold what the standard has no place for. Other programs ignore
them.

You edit one file, `data/family.src.ged`. The build writes
`data/family.ged`, a tidied copy for other programs such as Gramps.

## People

Every person needs a Flyleaf id and a confidence level. `flyleaf import`
adds both.

    0 @I0001@ INDI
    1 REFN john-penhallow
    2 TYPE jsonid
    1 _CONFLEVEL primary
    1 NAME John /Penhallow/

- **The id** (`REFN` with `TYPE jsonid`) is a short lower-case name. It
  appears in web addresses and in book files, so keep it once chosen. Two
  people cannot share one. Other programs keep their own numbers in `REFN`;
  Flyleaf leaves a `REFN` without `TYPE jsonid` as it is.
- **The confidence** (`_CONFLEVEL`) is one of `primary`, `tree-link`,
  `memoir` or `unknown`. See [research-standards.md](research-standards.md).

Flyleaf also reads names (`GIVN`, `SURN`, `NICK`, more than one `NAME`), sex,
births, baptisms, christenings, deaths, burials, cremations, marriages,
divorces, residences, occupations, education, military service, immigration,
notes and media.

## Parents

A person with more than one set of parents lists each family with `FAMC`.
Say which is which with `PEDI` (`birth`, `adopted` or `foster`):

    1 FAMC @F0007@
    2 PEDI birth
    1 FAMC @F0012@
    2 PEDI adopted

The book numbers the birth parents as ancestors when the tree records them.
In each family's list of children it marks an adopted or a foster child. The
site shows both sets of parents with their kind.

## Sources and citations

Make one `SOUR` record for each source. Cite it under the fact it supports,
with a `PAGE` that says where in the source the evidence is.

    0 @I0001@ INDI
    1 BAPM
    2 DATE 6 APR 1845
    2 PLAC St Just in Penwith, Cornwall, England
    2 SOUR @SRC_SJ_BAP1845@
    3 PAGE p. 31, entry 244: John, son of Richard Penhallow, miner
    3 QUAY 3
    3 _KEY john-baptism-1845

    0 @SRC_SJ_BAP1845@ SOUR
    1 TITL St Just in Penwith parish register, baptisms, 1845
    1 ABBR St Just baptisms, 1845
    1 _KEY st-just-baptisms-1845
    1 _TIER primary

- `TITL` names the source. `ABBR` is a shorter title for later notes.
- `PAGE` locates the evidence. A citation `NOTE` records a qualification.
- `QUAY` (0 to 3) is your assessment of this citation. Leave it out when you
  have not assessed it.
- `_KEY` is a stable name for the source or the citation. Book prose cites
  sources by key (see [book.md](book.md)), so a key survives a corrected title.
  Without a `_KEY`, a citation takes its key from its source's id: `@S12@`
  is `s12`. When one person cites a source in two different ways, such as on
  two pages, each citation gets its own key from its page and note, such as
  `s12-p-4` and `s12-p-9`. `flyleaf sources <id>` lists them.
- `_TIER` is the kind of source: `primary`, `authoritative-secondary`,
  `compiled-secondary`, `family-testimony`, `lead` or `unclassified`. Without
  it, Flyleaf classifies the source from its title.
- `_URL` is where the source is online, when that helps a reader.

In the register, a citation under a birth, baptism, christening, marriage,
divorce, death, burial or cremation prints as a footnote on that fact. The
book lists every other citation by person in "Sources for the Register",
and each source once in the bibliography.

When a person has two births or two deaths, the register prints the first,
with only its own citations. Each other one follows as "Birth was also
recorded at …", with its own notes. A date in another calendar keeps it:
`@#DJULIAN@ 14 MAR 1789` prints as "14 March 1789 (Julian)". A source with
no `TITL` is named by its `ABBR`, else its `AUTH`, else "Untitled source". A
citation note that points to a shared note (`3 NOTE @N1@`) prints that
note's text.

Some trees keep sources and research notes as plain notes. Flyleaf reads
this optional format:

- A note that starts with `[Source]` is a citation:
  `[Source] Title — https://…`.
- `[Notes]` starts research notes, and `[Confidence] primary` at the end of
  a note sets the confidence.
- `[TODO]`, `TODO:`, `OPEN:` and `INVESTIGATE NEXT:` mark open questions,
  which `flyleaf questionnaire` collects.
- A clause such as ` — image archived images/x.jpg`, or a mark such as
  `[DEAD 2026-01-02: page gone]`, is a note to the family. It never prints,
  and adding one never changes the source's key.

Native `SOUR` citations are better, because they attach a source to a fact.

## Files

Attach scans, photographs and documents with `OBJE` and `FILE`, under the
person, the family, the event or the source they belong to. Paths are
relative to the family folder:

    1 OBJE
    2 FILE images/documents/1866-penhallow-trembath-marriage-certificate.pdf
    3 FORM pdf

Under `FILE`, `_SHA256` records the file's checksum, so the build notices a
changed file. `TITL`, `_KIND` (such as `photograph` or `document`) and
`_LOCATOR` describe it.

## The site overlay: site/edition.ged

The website adds things the tree itself should not carry: which relatives the
site shows, which photographs are portraits, web-only notes. They live in a
separate small GEDCOM file, `site/edition.ged`, so the tree stays clean. The
build merges the two; the overlay can add to the tree but cannot change its
facts.

    0 HEAD
    1 _ATLAS
    2 TITL The Penhallow family
    2 _SUBTITLE A sample family history
    2 _ROOT @I0015@
    2 _BOUNDARY @F0009@
    2 _INCLUDE @I0017@

- `_ATLAS` names the site and its root person (`_ROOT`). The site shows
  everyone connected to the root through families. It does not cross a
  family named in `_BOUNDARY`, such as a spouse's parents; `_INCLUDE` adds
  one person beyond a boundary.
- `_ARCHIVE_CATALOG` under `HEAD` lists the sources and media records the
  archive page offers.
- New `OBJE` records add photographs, with `_CREDIT`, `_RIGHTS`, `_ALBUM`,
  `_VISUAL_ROLE` (such as `portrait`) and `_AVATAR Y` for a person's picture.
- Under a person, `_NARRATIVE` adds a web-only note, and `_BASE_HASH` pins
  the version of the person's record it was written for. After you edit
  that person in the tree, run `flyleaf repin` to record the new version.

`sample/site/edition.ged` is a full worked example. Without an overlay, the
site uses the family name as its title and the book's root person as its
root.

### Photographs on the website

A photograph the site shows in its album, or as a person's picture, needs
its own `OBJE` record in the overlay. The build checks each one and stops,
naming the problem, when a required line is missing.

    0 @PHOTO_JOHN@ OBJE
    1 FILE images/photographs/john-penhallow-portrait.jpg
    2 _SHA256 ef01005425ae285cb4bdc7e3dbcb6856a1d6dbdc40be5f41bc80479dab22228d
    1 TITL John Penhallow, about 1890
    1 _CONTENT photograph
    1 _ALBUM display
    1 _VISUAL_ROLE portrait
    1 _SUBJECT @I0001@
    1 _AVATAR Y
    1 _CREDIT Studio portrait, Mineral Point. Family collection.
    1 SOUR @SRC_FAMILY_PHOTOS@

Each photograph needs:

- `FILE`: a path under `images/`, to a `.jpg`, `.jpeg`, `.png`, `.webp` or
  `.gif` file, with one `_SHA256` line under it (the file's SHA-256 checksum,
  64 lower-case hexadecimal characters; `shasum -a 256 FILE` prints it).
  Each file may have only one such record.
- `TITL`: the caption readers see.
- `_CONTENT`: `photograph` or `artwork`.
- `_ALBUM`: `display` to show it in the album, or `alternate` for another
  version of a picture, shown after the main one.
- `_VISUAL_ROLE`: `portrait`, `group`, `place`, `object` or `memorial`.

These are optional:

| Tag | Meaning |
|---|---|
| `_SUBJECT @I…@` | A person in the picture. One line for each. |
| `_RELATED @I…@` | A person the picture belongs with, who is not in it, such as the family who lived in a house. |
| `_CAPTION_PERSON @I…@` | A person the caption names. |
| `_COMMEMORATES @I…@` | The person a memorial or gravestone is for. |
| `_OTHER_SUBJECT` | Someone in the picture who is not in the tree, in words. |
| `_QUALIFIED Y` | The people in it are identified with some doubt. |
| `_AVATAR Y` | Use it as the person's picture. Only for a `portrait` with exactly one `_SUBJECT` and no `_QUALIFIED`. |
| `_AVATAR_POSITION` | Which part of the picture to keep when it is cropped: `top`, `center` or `bottom`. Needs `_AVATAR Y`. |
| `_CREDIT`, `_RIGHTS` | The credit line, and who holds the rights. Shown under "Original captions and credits". |
| `_PUBLIC_NOTE` | A note readers see beside the picture. |
| `_DISCOVERY_NOTE` | Your own note about the picture. The site does not show it. |
| `SOUR @S…@` | The source the picture comes from. |

A record number such as `@I12@` in a caption or note stops the build. So
does a phrase in `text_checks.caption_errors`, where you list your own
research shorthand ([family-folder.md](family-folder.md)).

### Other overlay records

| Tag | Where | Meaning |
|---|---|---|
| `_ATLAS` | under `HEAD` | The site's title (`TITL`), subtitle (`_SUBTITLE`), root person (`_ROOT`), and who it includes (`_BOUNDARY`, `_INCLUDE`). |
| `_ARCHIVE_CATALOG` | under `HEAD` | The `OBJE` and `SOUR` records the archive page lists. |
| `_ARCHIVE path` | under a `SOUR` | A file in the archive for that source. Under it: `TITL`, `NOTE`, `_KIND` (such as `photograph`, `document`), `_NATURE` (what the original is), `_LOCATOR` (where the original is held), `_SHA256` and `_PAGE` (the page to open in a PDF). |
| `_PERSON @I…@` | under a `SOUR` | A person the source is about, so the source shows on their page. |
| `_STATUS research-only` | under a `SOUR` | The source is research notes, not a record. The archive labels it "Research notes". |
| `_CHAP` | a record of its own | A chapter of the site's story, with `REFN`, `TITL`, `_SUBTITLE`, `_ORDER` and one `_SECTION` for each part. A section has `TITL`, `_ORDER`, `DATE`, `_PERIOD`, `NOTE` paragraphs, `_PERSON`, `OBJE`, `SOUR`, a `PLAC` (with `_PRECISION`, `MAP` and `_SOURCE`, your note of where the map point comes from), and `_MANUSCRIPT`, the book story it draws on, with its `_HASH`. |
| `_NARRATIVE` | under a person | A web-only note, with `_BASE_HASH` (see above). |
| `_TYPE` | under an `OBJE` | A short kind for a picture, such as `portrait`, used by older records. |
| `_CAPTION` | under an `OBJE` link | The title to show for that picture in that place, in place of the file's `TITL`. |
| `_REPRESENTATION` | a record of its own | A file made from another, such as a page cut from a scanned book. Flyleaf writes these from `data/representations.json`, with `_PARENT`, `_ROLE`, `_METHOD`, `_RECIPE`, `_PROVENANCE`, `_SOURCE`, `_SOURCE_OBJECT` and `_IF_SOURCE`. Do not write them by hand. |
