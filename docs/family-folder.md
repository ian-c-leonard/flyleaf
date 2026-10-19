# The family folder

Each family keeps its own folder. Flyleaf reads it and writes the book and
other output into its `build/`. The website is built inside Flyleaf's own
folder, in `website/dist/`. `flyleaf new` makes a family folder from
`starter/`; `sample/` is a complete example.

    flyleaf.json          the family's settings
    data/family.src.ged   the family tree: the file you edit
    data/family.ged       made by the build for other programs; do not edit
    book/                 book settings, chapters, sketches, front and back matter
    images/               photographs, documents and other originals
    site/                 website content (every file is optional)
    email/                the invitation letter, if you write your own
    build/                the book PDF and other output

## How Flyleaf finds the family folder

The `flyleaf` command uses the first of these:

1. `--family DIR`;
2. the `FLYLEAF_FAMILY` environment variable;
3. the current folder, when it holds a `flyleaf.json`;
4. the folder that holds Flyleaf's folder, when it holds a `flyleaf.json`
   (a family that keeps Flyleaf inside its own folder);
5. the sample family in Flyleaf's `sample/` folder.

It says so when it uses 4 or 5, and passes the folder to every script it
runs. A script you run on its own, such as `node website/email/invite.mjs`,
looks in the same order, from 2. `make` runs from Flyleaf's folder, so the
current folder never counts. Name the family when you run a script or `make`
directly:

    FLYLEAF_FAMILY=../my-family node website/email/invite.mjs

Keep the family folder outside Flyleaf's own folder. To keep both in one git
repository, add Flyleaf to the family's repository as a submodule.

**Keep the family's repository private.** `flyleaf.json` lists invited
relatives' email addresses and which person each one is, and the tree and
the archive hold living relatives.

## Settings: flyleaf.json

Paths are relative to the family folder. Required values are marked.

### family, site, maintainer

| Setting | Meaning |
|---|---|
| `flyleaf` | The version of this settings format, now `1`. Leave it as it is: a later release may use it to update older settings. |
| `family.name` (required) | The family's name as readers see it: "The Penhallow family". |
| `site.id` (required) | A short id, used to name browser storage. |
| `site.domain`, `site.origin` (required) | Where the website lives: `example.family`, `https://example.family`. |
| `site.tagline` | The line under the name in the site header. |
| `site.credit` | `false` leaves "Built with Flyleaf", and its link to flyleaf.family, out of the site's footer. Default: `true`. |
| `site.theme_color` | The browser's theme colour. |
| `site.base_path` | The folder the site is served from, when it is not the root of its domain: `/demo/`. Default `/`. `FLYLEAF_BASE_PATH` overrides it for one build. |
| `site.hosting` | `static` (public files only) or `worker` (Cloudflare with sign-in). New families start as `static`; a `flyleaf.json` without the setting means `worker`, which lets nobody in until sign-in is set up. Any other value stops the build. See [hosting.md](hosting.md). |
| `site.publish_living_people` | `true` lets a static site show people who may be living. Without it, a static build stops and lists them. See [hosting.md](hosting.md). |
| `site.research_folders` | Folder names inside `images/` that hold research working files. The site leaves their files out, unless the tree gives a file a `_KIND` and a `_SHA256`. Default: `research`, `review`, `working`, `capture`, `captures`, `correlation` and `independent-reading`. `[]` names none. |
| `site.album_intro` | One sentence about the family album on Home, such as "Portraits, school days, homes and gardens." Default: a sentence built from the kinds of photographs in the album. |
| `site.archive_intro` | One sentence about the archive on Home. Default: "Documents and records behind the book." |
| `site.archive_first` | Words in file paths that the archive shows in its first group, with recordings and the recipe book, such as `["letters"]`. Default: none. |
| `maintainer.name`, `first_name`, `email` (required) | The person who keeps the history. The site credits them and offers their email. |
| `maintainer.pronoun` (required) | `he`, `she` or `they`, for sentences such as "She will check it". |

### paths

| Setting | Default in the starter |
|---|---|
| `paths.source_gedcom` (required) | `data/family.src.ged` |
| `paths.generated_gedcom` | `data/family.ged` |
| `paths.book` | `book` |
| `paths.site_content` | `site` |
| `paths.email` | `email` |
| `paths.source_tier_patterns` | none. A JSON file of extra title patterns for classifying your sources; see [research-standards.md](research-standards.md). |

### book

| Setting | Meaning |
|---|---|
| `book.pdf_name` (required) | The PDF's file name for downloads. |
| `book.subjects_label` | Who the book is for, in phrases such as "Paternal grandparents of Jory, Tamsin, and Nora". Default: the root person's first name. |
| `book.description` | A short description on the site's book page. Default: a sentence from the family name. |
| `book.typst.version` | The Typst version the book needs; the build stops on any other. |
| `book.fonts` | Typefaces. Default: the open Libertinus fonts bundled with Flyleaf. See below. |
| `book.research_sections` | Titles of the chapters about the research itself, such as "Methodology" and "Open Questions". They may discuss evidence, so the family-text check only warns there. A title that no chapter has is an error. Default: none. |
| `book.repeated_ancestors` | An ancestor reached by more than one line, as when cousins marry. `"once"` (the default) lists them, and their own ancestors, in full under their first number in the ancestor table and the charts; later numbers say "see no. N". `"every_line"` repeats them under each number, which can make a royal pedigree thousands of pages long. |
| `book.research_tab` | The title of one research chapter that the website shows on its own "About the research" tab. Default: no tab. |

`book.fonts` has four parts:

    "fonts": {
      "serif": ["Libertinus Serif"],
      "sans": ["Libertinus Sans"],
      "files": ["fonts/MySerif-Regular.otf", "..."],
      "chart_file": "fonts/MySerif-Regular.otf"
    }

`serif` and `sans` are family names in fallback order. `files` lists every
font file the build may use; Typst sees no other fonts, so the book lays out
the same on every machine. `chart_file` is the serif face used to measure and
letter the family charts.

### Hosting, sign-in and email

Only needed for `site.hosting: "worker"`. See [hosting.md](hosting.md).

| Setting | Meaning |
|---|---|
| `auth.clerk_publishable_key`, `auth.clerk_frontend_api` | The Clerk sign-in service. |
| `auth.allowed_emails`, `auth.admin_emails` | Who may sign in, and who reviews what relatives send. |
| `auth.viewer_people` | Each invited email address and the person in the tree it belongs to, so the site can say "your grandmother". |
| `cloudflare.*` | Worker name, account id, the two R2 buckets and the D1 database. |
| `features.submissions` | `true` to let relatives send photographs, memories and corrections. Anything else, or no setting, keeps sending off. A static site never offers it. |
| `email.from`, `email.invitation_subject` | For the invitation emails `website/email/invite.mjs` prepares. |
| `deploy.credentials_dir` | The folder holding `cloudflare.env` and `clerk.env`. |

### Smaller settings

| Setting | Meaning |
|---|---|
| `photos.occasion_words` | Words in a photograph's title that mark a family occasion, beyond wedding, graduation and engagement. Such photographs go in the album's occasions section, and a year in the title dates them. |
| `photos.dated_words` | Other words in a portrait's title that mean the title gives its year, such as "senior". Built in: yearbook, passport, school, class, the occasion words and the yearbook names. |
| `photos.yearbook_names` | The names of school yearbooks in your archive. A portrait whose title names one is dated by the year in that title. |
| `places.region_names` | Places the book should call regions ("in Cornwall") rather than towns ("at Penzance"). |
| `research.exempt_refns` | People the source checks skip, such as the compiler. |
| `names.married_surnames` | `true` to show married women on the website as "Given (Maiden) Married", the form family histories use. A recorded married surname (`_MARNM`) is used where there is one. Otherwise a woman who has died takes her husband's surname: from her latest marriage by date, or from her last marriage in the records when a marriage has no date. A last given name that matches her father's surname is shown as her maiden name. A living woman shows a married surname only when one is recorded (`_MARNM`). Default: everyone appears under their recorded name. |
| `names.short_forms` | Other forms of a given name, such as "Bill" for "William". The web book uses them to keep its links on the right person after you edit a passage. |
| `gedcom.source_id`, `gedcom.source_name` | The header of the GEDCOM file the build writes for other programs. |
| `gedcom.repositories` | Archives your sources link to, beyond the ones Flyleaf knows (Find a Grave, WikiTree, Internet Archive, FamilySearch and the U.S. National Archives). Each has a key, and a `name`, `url`, `address` and the `domain` its links use. A source whose links all go to one archive is filed under it. |
| `source_texts.format_aliases` | Your own names for the transcript formats in `data/source-text-companions.json`, mapped to Flyleaf's, such as `{"parish-entries": "register-entries"}`. |
| `text_checks.cited_authors` | Authors of your sources, for your own patterns: `{cited_authors}` in a pattern below stands for them, so `"{cited_authors} writes"` flags "Smith writes", which tells the story of the research instead of the family. On its own it flags nothing. |
| `text_checks.errors`, `event_note_errors`, `printed_book_errors` | Patterns that stop a deploy: in stories and captions, in notes on events, and in the printed book. `{maintainer}` and `{cited_authors}` stand for your first name and `text_checks.cited_authors`. Without them, the built-in phrases only warn. |
| `text_checks.source_process_phrases` | Your own research shorthand, such as "re-checked against". The tree check warns when a `[Source]` note holds one, since the note prints in a footnote. "image queued", "locate by searching" and a purchase date such as "purchased 2026-01-02" always warn. |
| `text_checks.caption_errors` | Patterns that stop the site build in a photograph's title or note. A tree pointer such as `@I12@` always does. |

## Site content: site/

Every file is optional. Without one, Flyleaf uses an empty version from
`website/content-defaults/` and the site leaves that feature out.

| File | What it holds |
|---|---|
| `edition.ged` | The site overlay: title, root person, which relatives to include, photographs, archive files and web-only notes. See [gedcom.md](gedcom.md). Without it, the site uses the family name and the book's root person. |
| `albums.json` | Family music: albums with tracks, credits and artwork. Listening files may be MP3, M4A, AAC, Ogg or Opus, originals WAV, FLAC or AIFF, and artwork a PDF or a picture. An optional `medium`, such as `"CD"`, gives wording such as "the original CD audio". |
| `family-recipes.json`, `recipe-index.json` | A recipe book: PDF volumes, their contents pages, a cover picture (`coverImage`), and an index of recipe names. The letter labels are needed only when the collection includes a letter. The `indexing` settings in `family-recipes.json` say how to find recipe names in the PDFs: `scripts/recipe-index.py` writes `build/recipe-index-candidates.json` for you to review, and you copy the names you keep into `recipe-index.json`. |
| `family-collections.json` | Curated collections of archive files shown on a person's page. |
| `home-records.json` | The records shown on the home page. |
| `geography.json`, `place-readings.json` | Map points for the places in the tree, and book passages tied to places. Without a geography, places stay off the map. Once it lists any place, it must list them all. |
| `display-copy.json` | Reader wording for particular book passages on the site. |
| `name-aliases.json` | Other names relatives use for a person, for search. |
| `changelog.json` | The site's "What's new" page, newest first. |
| `book-annotations.json` | Optional reviewed links from book passages to people and places. See "Reader links" in [book.md](book.md). |
| `monogram.png` | The image in invitation emails. |
| `screens.json` | The pages `website/scripts/compare-screens.mjs` captures. An entry with `"hosting": "worker"`, or one for `login/`, is skipped on a static site. Without the file: home, book, tree, photographs, archive and places, which every site has. |

## The book: book/

See [book.md](book.md). `book/web-selections.json` is optional: it chooses
web addresses for book headings, chapter highlights, and the people a
section is about. Without it, headings take addresses from their text.
