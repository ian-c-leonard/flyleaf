# Research playbook

This guide explains how a research session runs. It covers what to look
for next, where to look, when to stop, and how to bring what you find into
the tree. It is written for you, the family historian, and for the AI
assistant you may work with. Where the assistant's job differs from yours,
the guide says so.

Other guides cover the rest of the work:

- [research-standards.md](research-standards.md): kinds of source,
  confidence, reading records, negative findings, the research log and
  saving sources.
- [relatives.md](relatives.md): questionnaires, interviews, family papers
  and living relatives.
- [photos-and-documents.md](photos-and-documents.md): scanning, saving
  originals, file names and captions.
- [style-guide.md](style-guide.md): writing the book.
- [review.md](review.md): reviewing before you share or print.
- [journey.md](journey.md): the whole process, start to finish.

This guide describes a way of working. Following it does not make research
meet the Genealogical Proof Standard or any other standard. Whether it does
depends on the research itself.

## Ground rules

These hold in every session.

1. Facts go in one file, `data/family.src.ged`. The build writes
   `data/family.ged` from it and replaces it each time, so leave
   `family.ged` alone.
2. Every fact you add carries a citation to the record it came from.
3. A transcription, an index or another person's tree points to a record.
   Check the record itself before a fact enters the tree.
4. The assistant never invents a fact, a relationship, a motive or a face.
   When the records are silent, it says so.
5. When a record contradicts the tree, record the conflict and how you
   resolved it. Keep every conflicting record in the citations.
6. Use each website as its terms allow: your own account, at a person's
   pace.
7. You decide what to pay for, and you pay. The assistant proposes.

## The files you work from

A family folder made by `flyleaf new` has most of these files for research.
Two are written later by other commands, as the table says.

| File | What it holds |
|---|---|
| `PLAN.md` | The goal, your priorities, the task list, your standing decisions, and one dated line for each session |
| `AGENTS.md` | Instructions for your assistant |
| `research/questions.md` | Open questions that span several people, or need a plan |
| `research/requests.md` | Records to order, request or look up later |
| `research/log.md` | One entry for each session |
| `data/family.src.ged` | The tree: every fact and every citation. Written by `flyleaf import` from your genealogy program's file |
| `images/` | Originals: scans, record images, saved web pages |
| `book/COVERAGE.md` | Written by `flyleaf coverage`. It lists each ancestor with their number, confidence and story state, and the unknown parents of known ancestors |

A question about one person goes in a note on that person in the tree
(`1 NOTE`), starting with `[TODO]`. `flyleaf questionnaire` gathers these
sentences into a form for a relative to fill in, together with sentences
such as "not yet found" or "needs research" (see
[relatives.md](relatives.md)). It reads only notes on the person, so put
the question there, not in a note on a birth or a death.

### Starting a session

1. Read `PLAN.md`.
2. If the family folder is in git, see what changed since last time:
   `git status` and `git log --oneline -10`. Keep any unfinished work you
   did not start.
3. Pick the next open task, in priority order.
4. Read only the guides that task needs.
5. Before each task, ask: would a family member notice the result? Prefer
   work that changes what the family will read or see.

## How a session runs

A session is a loop with a time limit:

1. **Choose** the next target (see [Choosing targets](#choosing-targets)).
2. **Route** it to sources, cheapest first (see
   [The ladder of sources](#the-ladder-of-sources)).
3. **Research** it within the [stop rules](#stop-rules).
4. **Record** what you found in `data/family.src.ged`, with citations (see
   [Adding findings to the tree](#adding-findings-to-the-tree)).
5. **Check** the tree. Run `flyleaf book`: it checks the tree before it
   builds, and stops on errors. Fix the error, or undo the change, before
   you move on.
6. **Note** open questions and unsuccessful searches as they arise, in the
   person's notes.
7. **Go on** to the next target, until a checkpoint or the end of the time.

### Checkpoints

Every 45 to 60 minutes, or every five targets, whichever comes first, the
assistant sends you a summary of three to six lines:

- the targets it tried;
- what it found, and what it searched for without result;
- the changes it saved (commits, if you use git);
- any purchase it proposes.

Then it carries on without waiting, unless it needs a decision from you.

### Closing a session

Close every session this way, even one that is cut short:

1. Run `flyleaf book` and fix anything it stops on. If the family folder is
   in git, commit the files you changed. Push only if you keep a remote
   copy and have told the assistant to push. Leave other unfinished work
   alone.
2. Write an entry in `research/log.md`. The format is in
   [research-standards.md](research-standards.md#the-research-log).
3. Run `flyleaf coverage`, and note the new and stale stories (see
   [The book check](#the-book-check-at-session-close)).
4. Delete answered questions from `research/questions.md`, once the
   answer is in the tree and the log. Add the new ones.
5. Add to `research/requests.md` each record you found that has to be
   ordered, requested by mail, or looked up on a site you do not have.
6. Tick off finished tasks in `PLAN.md`, and add one dated line about the
   session.
7. The assistant ends with a wrap-up message: what it found, any confidence
   changes, money spent against the budget, and the single most valuable
   next step.

### Who does what

| Task | You | The assistant |
|---|---|---|
| Set priorities and the budget | Yes | Proposes, with reasons |
| Sign in to websites | Yes | Leaves sign-in pages to you |
| Search free sites | Yes | Only where the site's terms allow it, at a person's pace |
| Search subscription sites | Yes, with your own account | Only where the site's terms allow it, at a person's pace |
| Pay for records | Yes | Proposes each purchase with its expected value; never enters payment details |
| Write to the tree | Reviews the changes | One session writes; see [Several assistants at once](#several-assistants-at-once) |
| Decide a conclusion | Yes | Sets out the evidence for and against |
| Visit archives, cemeteries and relatives | Yes | Prepares lists, letters and questions |

## Choosing targets

Weigh three things for each candidate:

- what it could add to the family's story, or to an important line;
- the chance that the next source gives usable evidence;
- the effort it takes.

Then work through these steps:

1. **Name the payoff.** A good target has one: a turning point in someone's
   life, a relationship or conflict that matters, or a photograph or
   personal document you can identify.
2. **Name a source route you can reach.** Say how its answer could change
   the story, or the next decision about a line. An empty slot in the
   ancestor table does not, on its own, outrank a strong story or a
   picture.
3. **Set the stopping point before you start.** When the question is
   answered, or the routes you named stop paying off, save the source and
   the remaining question. Add what is supported. Then compare the
   candidates again.
4. **Use routine work as a tool.** Census runs and routine confidence
   upgrades serve these questions. Occupations, obituaries, photographs,
   letters and diaries can lead the research when they carry the story.

### How to rank candidates

| Kind of work | Priority |
|---|---|
| Settle an identity or relationship that changes a central story or line | High. It keeps the book from following the wrong family. Use a named source and a bounded question. |
| Document a life that mattered, or a turning point: migration, work, public life, loss, inheritance, a change that shaped later generations | High. It supplies the connected story. Judge what the sources can really give. |
| Recover identified photographs, letters, diaries or other personal papers of those people | High. They give the book a voice, a scene or a picture. Save the whole source and the basis of the identification. |
| Find a missing parent who opens a promising line, or links to a story you already have | High, when the gain is clear. A blank slot alone does not set the rank. |
| Resolve a conflict, or replace weak support for an important claim already in the book | High, when it could change the account. If no route can settle it, record the uncertainty. |
| Fill routine dates, add evidence where enough exists, or add distant collateral detail | Lower, unless it settles an identity or an important conclusion |
| Add another generation | Reassess first. Name what it would add and a credible way to find the records. |
| Follow an attractive connection with no records for the generations between | Do not adopt it or write it as family history. Interest in a source does not show kinship. |

Judge importance within the family, as well as in wider history. A person
who mattered in family life can carry a chapter. Fame is one kind of
interest among several.

Before you extend a branch, write down three things: what the next source
could change, why that matters, and when you will move on. A pass ends when
it answers its question, when the routes you named are used up, or when the
next step is worth less than another ready story or picture. At that point,
add what is supported. Keep the open question and the exact source
references for later. After a discovery, give further work on that branch
its own assessment before you carry on.

A written target, from Flyleaf's sample family:

> - **Target:** Olaf Solberg's parents.
> - **Payoff:** opens the Solberg line in Norway, and tests the family
>   memories that are all the tree has for him so far.
> - **Routes:** the 1900 census of Minneapolis; his Minneapolis birth
>   record; his 1968 death record and obituary, which may name his parents.
> - **Stop when:** a record names his parents, or these routes are used up.
>   Then compare the next candidates.

### Where to find candidates

- `book/COVERAGE.md`, after `flyleaf coverage`. Its "Research frontier"
  section lists the ancestor-table numbers of unknown parents of known
  ancestors. (The ancestor table, or ahnentafel, numbers people so that a
  father is twice his child's number and a mother is twice plus one.) Its
  tables show each ancestor's confidence.
- People at `tree-link`, `memoir` or `unknown` confidence.
- `[TODO]` notes in the tree.
- `research/questions.md`.
- Stories marked `stub` or `stale` that need a fact.

### Extending lines

- Extend a line only from a documented generation. When a generation has
  no good record, research that generation before you go further back.
- Treat a link to a famous or noble family as a question until every
  generation between has records.

## Where records are found

### Start with the place

Records were kept by place and by date. Before you search for a name:

1. Find out which parish, township, county, state or diocese the place
   belonged to at that date. Boundaries and names changed.
2. Find out what records survive for that place and time. The
   [FamilySearch Research Wiki](https://www.familysearch.org/en/wiki/) has
   guides by country, state, county and kind of record. The FamilySearch
   Catalog lists the records filmed or scanned for each place. It says
   which are online, which are indexed, and which can be viewed only at a
   FamilySearch centre or affiliate library.
3. Then search for names, in the collections you now know cover your
   person.

For a place you cannot find, try historical gazetteers, old county atlases
and plat maps (maps of land parcels with the owners' names). Useful free
tools include:

- the US Geological Survey's place-name database (GNIS), which lists many
  historical names;
- [GENUKI](https://www.genuki.org.uk/), for Britain and Ireland;
- the [Meyers Gazetteer](https://www.meyersgaz.org/), for the German
  Empire. It names the parish and the register office for each place.

In the sample family, Edith Rowe's birthplace, Rowe's Diggings, is
not in any gazetteer checked so far. It may have been a local name for a
mining camp, which is a question for county histories, maps and local
newspapers.

### The ladder of sources

Route every question to the cheapest source that can answer it, and climb
only when you need to.

| Rung | What | Examples | Who works it |
|---|---|---|---|
| 1 | Free, no sign-in | Chronicling America, Internet Archive, HathiTrust, Google Books, Find a Grave, BillionGraves, WikiTree, many archives' online indexes | You, or the assistant where the site's terms allow it, at a person's pace. Several of these sites limit automated access. |
| 2 | Free, with an account | FamilySearch: record search, images, the catalogue, full-text search | You make the account and sign in. The assistant works there only if the site's terms allow it. |
| 3 | Pay per record | Certificates from register offices, images from pay-per-view sites, copies of military files | The assistant proposes, with the expected value. You pay. |
| 4 | Subscription | Ancestry, Findmypast, MyHeritage, Newspapers.com, Fold3, GenealogyBank, American Ancestors (NEHGS) | You, with your own account. Subscribe when your list of subscription-only lookups justifies it (see [Budgets and purchases](#budgets-and-purchases)). |
| 5 | Offline | Records by mail, archive visits, cemeteries, relatives' papers and memories | You, with the assistant preparing lists and letters |

Check current charges before you pay for anything. Prices and what each
subscription includes change often.

### Kinds of record

Each kind below says what the records give, what to watch for, and where to
look. FamilySearch has indexes or images for many of them, so check it
early.

#### Civil registration: births, marriages and deaths

- **What they give.** Dates and places; for births, the parents, often with
  the mother's maiden name; for marriages, ages, residences and often the
  fathers; for deaths, the cause, the burial and an informant.
- **Watch for.** A death record's birth date and parents came from an
  informant, often years after the event. Registration began at different
  dates in different places, and early compliance was patchy.
- **Where.**
  - England and Wales, from July 1837: the free [FreeBMD](https://www.freebmd.org.uk/)
    index, and certificates ordered from the General Register Office.
  - Scotland, from 1855: [ScotlandsPeople](https://www.scotlandspeople.gov.uk/),
    pay per image. Scottish statutory entries are unusually full.
  - Ireland, all births and deaths from 1864, non-Catholic marriages from
    1845: many register images are free at
    [irishgenealogy.ie](https://www.irishgenealogy.ie/).
  - United States: registration was run by states and, before that, by
    counties and towns. Many states did not register every birth and death
    until the early 1900s. Before that, look to county registers, church
    records and newspapers. Order copies from the state vital records
    office or the county clerk.
  - Germany: from 1876 across the German Empire (earlier in some regions),
    held by local register offices and archives.
  - Norway: the state church kept the registers of births, marriages and
    deaths (see church records).

#### Censuses

- **What they give.** A household on one day: names, ages, birthplaces,
  occupations, and in later years relationships, immigration years and
  citizenship.
- **Watch for.** Ages drift from one census to the next. Whoever answered
  the door may have guessed. Indexes misread handwriting.
- **Where.**
  - United States, every ten years from 1790. Only heads of household are
    named before 1850. Relationships to the head appear from 1880. The 1890
    census was almost entirely destroyed by fire. Each census is released
    72 years after it was taken. Free indexes and images are on
    FamilySearch; the 1950 census is also on the National Archives' own
    site. Several states took their own censuses, often in years ending
    in 5.
  - Britain, every ten years from 1841. In 1841, adults' ages were usually
    rounded down to a multiple of five. The 1931 census for England and
    Wales was destroyed, and none was taken in 1941. The 1939 Register
    fills part of that gap. Censuses open after 100 years.
  - Ireland: the 1901 and 1911 censuses are free at the National Archives
    of Ireland. Most earlier ones were destroyed.
  - Norway: the surviving censuses, from 1801, are free at the
    [Digitalarkivet](https://www.digitalarkivet.no/).

#### Church records

- **What they give.** Baptisms, marriages and burials. Before civil
  registration they are the main record of most lives. Sponsors and
  witnesses are often relatives.
- **Watch for.** A baptism date is not a birth date. A family may appear in
  more than one denomination's registers. The copy you see may be a later
  transcript, not the register.
- **Where.**
  - England: parish registers from 1538, held by county record offices.
    Bishops' transcripts (yearly copies sent to the bishop) can fill gaps.
    Many registers are indexed on FamilySearch, Findmypast and Ancestry,
    and by volunteers on FreeREG. Some counties have free online parish
    clerk projects, such as the Cornwall Online Parish Clerks database.
  - Scotland: the Church of Scotland's registers before 1855, on
    ScotlandsPeople.
  - Germany: church books, held by the churches and their archives.
    [Matricula](https://data.matricula-online.eu/) has free images, mostly
    of Catholic registers; [Archion](https://www.archion.de/) has
    Protestant registers by subscription.
  - Norway: church books are free at the Digitalarkivet. Many Norwegians
    used a patronymic (a name from the father's first name) or the name of
    the farm where they lived. A surname used in America may be a farm
    name, and may change from one record to the next. Printed local farm
    and family histories (bygdebøker) can help; treat them as compiled
    work.
  - United States: records stay with the congregation, or go to the
    denomination's archive or a historical society. Ask where a closed
    church's books went.

#### Probate and land

- **What they give.** Wills, administrations (the court's handling of an
  estate when there is no will), inventories, guardianships, deeds and
  mortgages. They often name heirs, married daughters and their husbands,
  and neighbours.
- **Watch for.** An index card or calendar entry is not the will or the
  estate file. Cite each for what it is.
- **Where.**
  - United States: the county courthouse (probate court, register of
    deeds or recorder). FamilySearch has many of these records on film,
    often unindexed. Its full-text search reads machine transcriptions of
    many of them (see [Using record sites](#using-record-sites-well)). For
    the first sale of federal land, the Bureau of Land Management's
    [General Land Office Records](https://glorecords.blm.gov/) site is free.
  - England and Wales: from 1858, a national probate calendar you can
    search online, with copies to order. Before 1858, wills were proved in
    church courts. Those of the Prerogative Court of Canterbury are at The
    National Archives.

#### Newspapers

- **What they give.** Obituaries, marriage and birth notices, local news
  columns, court reports, advertisements, and the life of the town.
- **Watch for.** Optical character recognition (the machine reading of
  printed pages) jumbles columns and misreads names. Search spelling
  variants and read the whole page. An obituary is good evidence for a
  recent death, and weaker for events long before.
- **Tips.** After a death, check the following days and weeks too: funeral
  reports, cards of thanks and estate notices often name relatives and
  heirs. Look for small-town columns and newspapers in your family's own
  language, such as the Norwegian-language and German-language press of
  the American Midwest.
- **Where.** [Chronicling America](https://www.loc.gov/collections/chronicling-america/)
  from the Library of Congress, free, for American papers up to 1963.
  Subscription archives: Newspapers.com, GenealogyBank, NewspaperArchive,
  and the British Newspaper Archive (also on Findmypast). Free national
  collections elsewhere include Trove (Australia) and Papers Past (New
  Zealand). Many state and local libraries have digitised papers or hold
  microfilm.

#### Military records

- **What they give.** Service dates, units, physical descriptions,
  birthplaces, and in pension files, letters, affidavits and marriage
  proofs. Pension files are often the richest record of an ordinary life.
- **Watch for.** A draft registration shows that a man registered. It does
  not show that he served.
- **Where.**
  - United States: the National Archives holds service records and pension
    files for the earlier wars, and copies can be ordered. The 1917–18
    draft registration cards, which cover most men born from about 1872 to
    1900, are free on FamilySearch. Fold3 is a subscription site for
    military records. A 1973 fire at the National Personnel Records Center
    destroyed most Army personnel files for soldiers discharged between
    1912 and 1960. For a soldier of that time, also look for discharge
    papers among family papers; many veterans recorded them with the
    county. In the sample family, Robert Penhallow's 1942 Army enlistment
    record is the starting point for his service.
  - Britain: most First World War soldiers' service records were destroyed
    in 1940; the survivors, and medal index cards, are online.
  - War dead: the Commonwealth War Graves Commission and the US
    Department of Veterans Affairs' Nationwide Gravesite Locator have free
    databases.

#### Immigration and naturalisation

- **What they give.** Passenger lists give the ship, the date, the age and
  often the last residence and destination. Later lists name a relative
  left behind and the person joined. Naturalisation (becoming a citizen)
  records can give the birthplace, the arrival and the ship.
- **Watch for.** Early lists give little more than a name, an age and a
  country. Names were written by clerks, and families later remembered
  arrival years loosely.
- **Where.**
  - United States: passenger lists survive from 1820. The Statue of
    Liberty–Ellis Island Foundation's free database covers arrivals at New
    York. FamilySearch and the subscription sites hold lists for other
    ports. Before 1906, any court could naturalise: county, state or
    federal. A declaration of intention ("first papers") came first and a
    petition ("second papers") later, often years apart. From 1906 the
    forms are standard and much fuller, and US Citizenship and Immigration
    Services runs a paid genealogy service for those files. Before 1922 a
    wife usually took her husband's citizenship, so she may have no papers
    of her own.
  - Departure records: Hamburg's emigrant lists survive from 1850; most of
    Bremen's do not. Norway's police emigration registers from several
    ports survive from the 1860s and 1870s, free at the Digitalarkivet.
    British outbound lists survive from 1890.

#### Directories

- **What they give.** A person's address and occupation year by year,
  widows listed as "widow of", and business partners. A run of directories
  can show when someone arrived, moved or died.
- **Watch for.** Take the period a directory covers from its title page. A
  directory dated for one year was often compiled the year before. Machine
  reading misreads numbers: an address of 319 can appear as 819.
- **Where.** American city directories are on Ancestry and in many
  libraries; older ones are free on Internet Archive, HathiTrust and Google
  Books. British trade directories, such as Pigot's and Kelly's, are free
  in the University of Leicester's historical directories collection and in
  the same digital libraries.

#### Published genealogies and local histories

- **What they give.** Compiled family histories, county histories with
  biographical sketches, articles in genealogical journals, and printed
  transcripts of records.
- **Watch for.** Most are compiled work: weigh them by whether they cite
  records, and check them against the records where you can. The
  biographical sketches in subscription county histories of the late 1800s
  and early 1900s were usually written from family interviews. Read the
  key in a printed record volume's front matter: entries in brackets may
  come from a different and less reliable source than the rest.
- **Where.** Internet Archive, HathiTrust, Google Books and the
  FamilySearch Digital Library, for older books. For Massachusetts towns,
  the printed volumes of vital records to 1850, published in the early
  1900s, are free there. To find journal articles, search the Periodical
  Source Index (PERSI) on Findmypast. Journals include *The New England Historical and Genealogical
  Register* (NEHGS), the *National Genealogical Society Quarterly* and *The
  American Genealogist*.

#### Cemeteries

- **What they give.** Gravestone inscriptions, burial dates, and who lies
  near whom. Cemetery office and sexton (caretaker) records show who bought
  each plot and who is buried in it, including people with no stone.
  Funeral home records name the informant and who paid.
- **Watch for.** A stone may have been placed years later. A volunteer's
  memorial page is only as good as its contributor, and its family links
  are often missing or wrong.
- **Where.** Find a Grave and BillionGraves, free and built by volunteers:
  a photograph of an inscription counts as compiled evidence, and the
  family links as leads. Flyleaf classes these sites as leads unless you
  set `_TIER compiled-secondary` on a memorial whose photograph you have
  read. Family history societies in Britain have published surveys of
  gravestone inscriptions. Ask the cemetery office for burial and plot
  records.

#### Dates before 1752

England, Wales, Ireland and the British colonies began the year on
25 March until 1752. Scotland moved to 1 January in 1600. A date from
1 January to 24 March before 1752 is often written with both years, such
as 14 February 1736/7. Quakers numbered their months: before 1752, the
"first month" was March; from 1752, it was January.

`flyleaf coverage` warns about a January to March date before 1752 that is
written without both years. It checks only the book's ancestors: their
births, deaths and marriages. Check other people's dates yourself.

### Using record sites well

#### Searching

- Search broadly, then narrow. Try spelling variants, initials, and the
  name as a clerk might have heard it. Use wildcards where the site allows
  them, such as `Penhal*`.
- Search with one or two facts you are sure of, not all of them. The index
  may have the age or the place wrong.
- Confirm that the search ran as you meant. A date typed into a box may not
  apply until you press Enter or a button. Look at the results and the
  filters shown, and the web address if it carries them. A broad search
  can return records outside your terms.
- Know what the index covers. Read the collection's description: years,
  places and which record series. Some series are not indexed by name at
  all. "No results" can mean the record was never indexed, or never put
  online.
- Load every result before you call a list read. A count of results is not
  a search of every image.
- Indexes contain errors: a misread letter in a name, a wrong digit in a
  number. Check the image for every letter and number you rely on.
- A name index made by machine reading misses people, sometimes whole
  households. Absence from such an index is weak evidence. Search by
  surname alone, or browse the images for the place.
- An exact date in someone's online tree hints that a record exists. Find
  the record.
- "Similar records" suggestions and links from other people's trees are
  leads to records.
- Volunteer indexes, often built by ethnic or regional genealogy
  societies, can fill gaps that official indexes leave. They can also give
  the certificate number you need to order a copy.

FamilySearch's full-text search reads machine transcriptions of handwritten
deeds, wills, court records and other documents. It makes it possible to
find your family's FAN club: their friends, associates and neighbours, who
appear as witnesses, buyers, sellers and heirs. Search a name in quotation
marks, then filter by place and date. Use wildcards freely for the letters
the machine may have misread, such as `C?le` or `Tre*ath`. The transcript
is a finding aid. Cite the image.

#### Reading what a site shows

- Read the place from the record itself, not from the title the site gives
  the set of images. A set can be labelled with a place that is wrong for a
  record inside it.
- Record both the image number in the viewer and the page or entry number
  on the original. They often differ. On a microfilm that holds several
  items, note the item number too.
- Images can be out of order on a film. The date range in a collection's
  title is not always its full span. The catalogue entry describes it.
- Check where a document begins and ends. A facing page can belong to
  someone else, and an adjoining page can complete your person's document.
  Save the pages that complete it.
- Leave blank what the record leaves blank. Never fill your family's line
  from a neighbour's line on the same page.
- A certificate number can repeat across different series in the same
  place and year, and a site can show the wrong couple's image for a
  number. Read the names on the image before you save it.
- An online profile in a shared tree, such as FamilySearch's, often draws
  on records. Use it as a strong lead: cite the profile, and check the
  images when a fact matters.

#### Saving and citing what you find

What to save and how to name it is in
[research-standards.md](research-standards.md#saving-your-sources) and
[photos-and-documents.md](photos-and-documents.md). These habits apply to
record sites:

- Save the record at the size the site offers, where its terms allow. Save
  the whole page, not only the article or the line.
- Open the file you saved and confirm that it shows the record you meant.
  A click on "Download" is not a saved file until you have looked at it.
- Use the download and print controls the site provides. Do not alter a
  link to get a bigger image, and do not share links that carry access
  codes.
- When you save a web page as a PDF, check every page. A pop-up can cover
  the fields you wanted.
- When you download a whole book, look at a few pages spread through it.
  Catalogue entries are sometimes wrong, and the file may be a different
  book.
- Cite the collection's title and the image, film or certificate number,
  so a reader can find the record if the link dies. Add the site's
  permanent link where it has one. FamilySearch's permanent links contain
  `ark:`.

#### Keeping notes on each site

Keep your own notes on how each site works: which searches found things,
what each index covers, and what to watch for. Add to them whenever a site
teaches you something new. A file such as `research/sites.md` works well.
Flyleaf does not make this file; start it yourself.

#### What each kind of site is good for

| Kind of site | Good for | How much weight |
|---|---|---|
| Government archives and register offices | Images of original records; official indexes | The image is the record. The index is a finding aid. |
| FamilySearch record collections | Indexes and images of civil, church, census, probate, land and many other records | The same: cite the image |
| Subscription record sites | Indexes and images, newspapers, military records, hints | The same. Hints are leads. |
| Member trees on any site | Pointers to records | A lead. Do not cite one as evidence. |
| Shared trees and profiles (WikiTree, the FamilySearch Family Tree) | Leads, and the citations they list | A lead. Follow the citations to the records. |
| Cemetery sites | Burial places, photographs of stones | A photographed inscription is compiled evidence. Family links are leads. |
| Digital libraries | County histories, genealogies, directories, printed records | Compiled work, unless it cites records you can check |
| Newspaper archives | Obituaries, notices, local news | A contemporary notice is good for the event it reports. Recollections are weaker. |
| Volunteer indexes | Gaps in official indexes; certificate numbers | A finding aid |

How to classify each source is set out in
[research-standards.md](research-standards.md#kinds-of-source).

### Hints and other people's trees

Subscription sites suggest records ("hints") for people in a tree you keep
there. Handle each hint in this order:

1. **Open the record and identify the person.** Ask first: is this our
   person? Require at least two points of agreement: the name and one fact
   you have already documented. A perfect match on name and date can still
   be a different person. Two men named John Williams can be born in the
   same county in the same year.
2. **Compare every field with your tree.** Sort each into a new fact,
   agreement with what you have, or a conflict. Record a conflict in the
   person's notes with how you resolved it.
3. **Save the record image** at full size, where the terms allow. If there
   is no image, the hint is an index-only lead. Say so in the citation.
4. **Cite it in your tree,** on every person the record speaks to. Run
   `flyleaf book`.
5. **Only then act on the hint** on the site. Accept it once the record is
   in your tree. Dismiss it if it is the wrong person or adds nothing. When
   the rejection itself tells you something, such as a namesake in the
   same town, add a note to the person.

Accept no hint that comes from another member's tree. Use those trees only
to find records, and check each record yourself.

Work hints in this order:

1. Hints that could solve a problem you are stuck on.
2. Well-documented ancestors with many hints, such as an obituary, several
   censuses and military records.
3. Photographs.
4. Records from other countries.
5. Member trees, last.

Hints change as a site indexes new collections, so look again from time to
time. Do not take a site's suggested spelling of a name on trust. Sites
often turn a rare name into a common one. Check the spelling against the
records.

Keep your own tree file as the master copy. A tree on a subscription site
mirrors it and follows it. Bring facts into your file one at a time, with
citations. Importing a site's tree wholesale back into your own mixes
unchecked facts into checked ones.

### Using sites within their terms

- **Your own account.** Use your own subscription or account. You sign in.
  Do not give the assistant your password, and do not store passwords in
  the family folder.
- **A person's pace.** Use a site the way a person would: through its own
  search pages, links and buttons, pausing to read. Do not build or edit
  web addresses to reach records. Use a data service only when the site
  offers it publicly for that purpose, and keep within its stated limits.
  Save what you fetch, so you never fetch the same page twice.
- **Only what the question needs.** Do not download whole collections or
  gather records in bulk.
- **Read the terms first.** Some sites forbid automated access of any
  kind, including an assistant working in your own signed-in browser. Some
  forbid using their content to train AI. Read each site's current terms
  before an assistant works on it. Where the terms forbid it, you do the
  searching and give the assistant the records you saved.
- **Stop at any check.** If a site shows a bot check, an access-denied page
  or a puzzle to solve, the assistant stops at once. It hands that site
  back to you, and never tries to get past the check. Repeated trips can cost
  you the account.
- **Regional blocks.** Some sites refuse readers from other regions. Look
  for another copy instead, such as a library's newspaper database or
  microfilm, or write to the library in that town.
- **Lending libraries.** Some digital libraries lend in-copyright books for
  an hour or two at a time. Read a borrowed book in the library's own
  reader and take notes there. Do not download it.
- **A browser profile of its own.** Give the assistant a separate browser
  profile. It then cannot see your other tabs, saved passwords, or the
  accounts you are signed in to. Sign in to each site in that profile
  yourself. If the assistant must use your own browser, it checks first
  which tabs are open, stops at any sign that you are using it, and leaves
  sign-in pages to you.
- **Living people.** Collect only what the next section allows.

### Living people

Write about living people only from what they have shared and from public
records. Consent and interviews are covered in [relatives.md](relatives.md),
and the evidence rules in
[research-standards.md](research-standards.md#living-people).

You may record:

- a year of birth;
- a public profession or role;
- schools named in published yearbooks;
- marriages in public records;
- the town of a past home, from a census or a directory, without the
  street address, which may still be their home;
- family relationships.

Keep these out of the tree:

- current addresses and present whereabouts;
- employers;
- phone numbers;
- social media profiles.

Skip any hint or record that looks like a copy of social media or a
people-finder site.

Flyleaf helps at publication. A static site build stops and lists everyone
who may be living. `1 RESN privacy` keeps a person off a public site only
when the book does not name them. For someone the book names, the build
stops instead (see [hosting.md](hosting.md#a-static-site)). A questionnaire
names other people who may be living without showing their facts.

## Stop rules

- **Documented generations only.** Extend a line only from a generation
  with good records.
- **Unsuccessful searches.** Record the collection, what it covers, the
  search you ran and the result. The format is in
  [research-standards.md](research-standards.md#negative-findings). Two
  sources without a result can justify pausing a task. They do not show
  that the research was thorough, and they are not negative evidence. Describe the edge of what
  you searched before you mark a question as exhausted. An absence supports
  a conclusion only when the information would be expected in records that
  survive.
- **Choose records for the question.** Census runs are valuable, but a
  decisive baptism, probate file or sibling's record need not wait until
  every census year is done.
- **Follow useful threads.** Research may go broad or deep, and follow a
  lead wherever it lies. Collateral relatives (brothers, sisters, cousins
  and their families), places, land, schools and work can light up a story
  as well as settle a parentage. Write down why a lead matters and what it
  gave. Your list of targets is a starting point, not a limit.
- **Save what you come across.** You will meet photographs and documents
  of the family that are off the current question. Save each one, with
  where it came from. Keep the full original beside any crop. Note it under
  the chapter it belongs to, in `PLAN.md` or `research/questions.md`.
- **Fifteen minutes.** If one lookup runs about fifteen minutes without
  progress, write down where you stopped, as a `[TODO]` note with the exact
  next step, and move on.
- **One hour.** If a task runs an hour without progress, step back. Try a
  simpler route, or ask.
- **Conflicts stop integration.** When a source contradicts a fact that
  rests on an original record, stop. Record the conflict in the person's
  notes. Change no fact or family link until the conflict is resolved.

## Adding findings to the tree

### Citing a fact

Cite each fact under the event it supports, with a `SOUR` record for the
source and a `PAGE` that says where in the source the evidence is.
[gedcom.md](gedcom.md#sources-and-citations) shows the format, with `QUAY`
(your assessment of the citation; see
[research-standards.md](research-standards.md#citation-quality-quay)),
`_KEY` and `_TIER`.

- Give a source a `_KEY` and keep it. Stories cite sources by key. If you
  rename a key a story cites, the build stops, because the story now cites
  a source the tree does not have.
- Put a qualification in the citation's `NOTE`. For example: the informant
  was the deceased's son, so the birth date is a recollection.
- Keep research notes out of text the family reads.
  [research-standards.md](research-standards.md#where-notes-appear) says
  which notes print in the book or show on the site. The tree check warns
  about research shorthand in a `[Source]` note, and
  `flyleaf coverage --wording` lists research wording in text that readers
  see. See
  [book.md](book.md#what-the-build-checks) and `text_checks` in
  [family-folder.md](family-folder.md#smaller-settings).

### Adding a person

Each new person needs:

1. An id: a `REFN` with `2 TYPE jsonid`, made of lower-case letters, digits
   and hyphens, such as `olaf-solberg`. `flyleaf import` adds ids to an
   imported tree. When you add someone by hand, you write the id. The build
   stops on a duplicate id or one with other characters.
2. A confidence level, `_CONFLEVEL`, that the sources justify. The build
   stops when a person marked `primary` has only weaker sources (see
   [research-standards.md](research-standards.md#confidence)).
3. At least one citation.
4. A short note that explains how they connect to the family.
5. Family links in both directions. A child's `FAMC` must match the
   family's `CHIL`, and a spouse's `FAMS` must match the family's `HUSB` or
   `WIFE`. The build stops when a child link is one-sided (it prints
   `S3-FAMC-NO-CHIL` or `S3-CHIL-NO-FAMC`), and warns about a one-sided
   spouse link.

The full checklist is in
[research-standards.md](research-standards.md#adding-a-new-person). Run
`flyleaf book` after each new person. If the family folder is in git,
commit after every five to ten additions, with a message that says what
changed, and push at checkpoints.

### Recording a conflict

The sample family shows the pattern. A county album of 1904 says John
Penhallow came to America in 1867. The 1868 passenger list and his 1912
obituary both say 1868. The tree uses 1868, cites all three sources, and
keeps a note that explains the choice: the album was compiled long after
the event. Write the reasoning down. A reader, or you in five years,
should be able to follow it.

### When a conclusion changes

Update every place that states it: the tree, each story, captions,
profiles and site notes. `flyleaf coverage` lists the stories whose
people's records changed (see [The book check](#the-book-check-at-session-close)).
Keep the old reading in a note.

### One place to edit

Decide where you edit the tree. You can edit `data/family.src.ged`
directly, or keep working in your genealogy program and import again.
Importing again replaces the file, so edits made by hand in
`family.src.ged` are lost (see [quick-start.md](quick-start.md)). Mixing
the two loses work.

Pictures and documents are attached with `OBJE` and `FILE` (see
[gedcom.md](gedcom.md#files) and
[photos-and-documents.md](photos-and-documents.md)).

## Transcription with an AI assistant

AI models can read old handwriting, but they make mistakes, and some fall
on names and numbers, the words a family history depends on. Models can
also modernise old spelling without saying so, changing "perfict" to
"perfect" in a will. Sometimes they skip a whole line.

- **Think before you upload.** A record you give an AI tool goes to the
  company that runs it. Recent records often name relatives who are still
  living, so you would be sharing their details with that company. Cover
  those details first, or transcribe such records yourself. Some record
  sites also forbid putting their images into AI tools. Read the site's
  terms before you upload a record from it.
- **Keep the record's words.** Keep the original spelling, capitals,
  punctuation and line breaks. Do not expand abbreviations silently. If you
  expand one, put the added letters in square brackets. The transcription
  follows the record, not the style guide.
- **Use several models for anything you rely on.** Transcribe a handwritten
  record with two or three models from different companies. Compare their
  outputs line by line, and have a person check each disagreement against
  the image. The historian Mark Humphries has described this method. The
  person then reads the lines where the models disagree, rather than the
  whole text.
- **Count the lines.** If every model skips the same line, a comparison
  will not show it. Count the lines against the image.
- **Give the best image.** Use the full-size image. Where the tool lets you
  choose, pick its most literal setting (often called temperature, at its
  lowest). Ask the model to mark unreadable words `[illegible]` rather than
  guess.
- **Check every fact against the image** before it enters the tree.
  Transcriptions and machine indexes, FamilySearch's full-text search
  included, are finding aids.
- **Record the method in the citation note,** such as: "Transcribed with AI
  assistance (tools and versions, date); checked against the image by
  [your name]."
- **Treat a site's own AI output the same way.** Machine transcriptions and
  generated life stories on record sites are finding aids, however fluent
  they read.
- **Look beyond the text layer.** Text taken from an ebook or a scanned
  book can miss whole captions and tables. Look at the pictures, tables,
  title pages and neighbouring pages before you treat the text as complete,
  or draw a conclusion from what it does not say. A caption printed inside
  a picture is often missing from the text. Save the image and the text
  beside it, each with its own page reference.
- **Hard scripts.** For old German handwriting, Latin registers or damaged
  pages, a dedicated handwriting tool such as Transkribus, or a human
  reader, may do better. Use an AI model as a second opinion.
- **Abstracts.** To abstract a deed or a will, give the assistant your own
  checked transcription. Ask for a standard abstract: parties, date,
  property, price, witnesses and every stated relationship. Check each
  relationship against the text. Models have reversed parent and child.
- **Translations.** Treat them the same way: two models, a person checking
  the differences, and the original-language text kept beside the
  translation.

## Re-reading records before you write

Names drift towards common spellings over a long session, and facts blur.
Before you or the assistant draft a story:

1. Give the assistant fresh copies of the records of the people in it: the
   entries from `data/family.src.ged`, and the list from
   `flyleaf sources <id>`. Do not rely on what was said earlier in the
   conversation.
2. Work on one family or one chapter at a time. Do not hold the whole tree
   in play.
3. Read the warnings from `flyleaf coverage`. It warns about a name one
   letter away from a name in the tree that the tree never uses, such as
   "Tamsyn" in a tree that spells it "Tamsin".

[book.md](book.md#writing-with-an-ai-assistant) describes a drafting loop,
and [style-guide.md](style-guide.md) how to write the stories.

## The book check at session close

Run `flyleaf coverage` at the end of every session. It writes
`book/COVERAGE.md`.

- **New ancestors** appear as `missing`. Run `flyleaf scaffold` to start a
  story file for each.
- **Changed people** appear as `stale`: their records changed after their
  story was last marked current. Reread each story against the new record,
  then run `flyleaf coverage --mark <id>` (see
  [book.md](book.md#keeping-stories-current)).
- Report both in the wrap-up, so the next writing session knows what to
  revise.

The register, the charts, the ancestor table, the bibliography and the
index rebuild themselves from the tree. Only the stories need a person's
work.

## Budgets and purchases

| Kind | Rule |
|---|---|
| Free sources | Use them freely, within each site's terms |
| Small purchases | Set a standing budget for each session. The assistant proposes each purchase with its expected value and what it unlocks. You pay. The assistant then brings the record into the tree. |
| Larger purchases | Ask in one batch, with the expected value of each. Examples: a federal military file, or a society membership. |
| Subscriptions | Keep a list of subscription-only lookups. Subscribe for a month when the list holds enough strong targets, such as fifteen. Then work through them in batch sessions. |

The expected value of a record has three parts:

- what it is likely to contain;
- how likely it is to concern the right person;
- what it would change in the tree or the book.

- The assistant never enters payment details.
- A purchase over the budget, or a speculative one, waits for a batched
  request with reasons at a checkpoint.
- Before buying, check whether you already hold the record or have unused
  credits on the site.
- Record each purchase and its cost in the log.
- Check current charges every time. Do not rely on old notes of prices.

## Research beyond the internet

Online records cover only part of what survives. These routes reach the
rest.

### Relatives

Living relatives are often the richest source a family has. Send a
questionnaire first and call afterwards. `flyleaf questionnaire <id>`
writes a form for a relative that shows what the records already say, for
them to correct, and asks the open questions from the tree.
[relatives.md](relatives.md) covers questionnaires, interviews and
consent.

### Records by mail or in person

- **Certificates** from register offices, state vital records offices and
  county clerks, where free images stop.
- **County courthouses:** probate files, deeds, court cases, and
  naturalisations before 1906.
- **Municipal archives:** city records and certificates beyond what is
  online.
- **National archives:** military service and pension files, and federal
  court records. In the United States, the National Archives; in Britain,
  The National Archives at Kew.

How to ask:

1. Ask for one record per request.
2. Give the name, the date range, the place, and any index reference, such
   as a certificate number or volume and page.
3. Ask for a full copy of the original, not an extract or an abstract,
   unless only those are offered.
4. Check who may order (some records are restricted by age or to
   relatives) and the current charges.
5. Keep the request in `research/requests.md`, and the reply with the
   record.

### Archives and special collections

Kinds of collection worth searching:

- denominational archives and historical societies: records of ministers,
  congregations and missions;
- college and school archives: student records, yearbooks, alumni
  magazines;
- county genealogical and historical societies, and public libraries:
  county histories, plat maps, local church records, obituary indexes,
  files of clippings;
- major genealogy libraries, such as the Family History Library in Salt
  Lake City, the Allen County Public Library's Genealogy Center and NEHGS
  in Boston;
- local historical societies: church registers, city directories,
  photographs;
- city and municipal archives' reading rooms;
- family history societies in the place the family came from: parish
  background, local records, and surveys of gravestone inscriptions.

Search their online catalogues first. Then send a short query by email:
the names, the dates, and what you hope they hold. Ask about research
services and charges; many will look up one item for a fee. Keep the reply
and cite it.

### Visiting places

- **Cemeteries.** Photograph every family stone, front and back, and the
  stones around it. Relatives are often buried close together. Note the
  section and row. Ask the office or the sexton for burial and plot
  records.
- **Homes, farms, churches and workplaces.** Photograph them for the book.
  Use plat maps and land records first, to find the right parcel. Many
  cities renumbered their streets, so check an old address against a map
  of its time.
- **Archives.** Take your list from `research/requests.md`.

[photos-and-documents.md](photos-and-documents.md) covers photographing
and scanning.

### Family papers

Ask every relative what they hold: Bibles, letters, diaries, photograph
albums, scrapbooks, wedding books, funeral cards, deeds and papers in
drawers, discharge papers, naturalisation certificates, school reports.
Family papers often hold facts that no website has. Record who holds each
item, who scanned it, and when. [relatives.md](relatives.md) covers asking,
and [style-guide.md](style-guide.md) how to cite them.

## Keeping the lists

### Open questions: research/questions.md

A question about one person goes in a `[TODO]` note on that person in the
tree. Use `research/questions.md` for questions that span several people,
need a plan, or depend on an outside record. See also
[research-standards.md](research-standards.md#open-questions).

The file is a table, with one row for each question:

| Column | What it holds |
|---|---|
| Question | The question, in one line |
| People | The id of each person it concerns |
| Why it matters | What the answer would open or change |
| Next record to try | The record most likely to answer it, and where it is |
| Tried so far | The searches made, and where they stopped |

Put the questions for the edition you are working on at the top. When a
question is answered, record the answer in the tree, note it in
`research/log.md`, and delete the row.

A question that needs more room keeps its row. Add a section below the
table, headed with the question. Use it for what is known, with its
sources; what is unclear; each record that could help, and how to reach
it; and the question's value, its chance of success and the effort. Delete
the section with the row. An example, from the sample family:

```markdown
| Question | People | Why it matters | Next record to try | Tried so far |
|---|---|---|---|---|
| Who were Herman Kessler's parents? | `herman-kessler` | Opens the Kessler line | The 1910 census of Madison | Nothing yet |

## Who were Herman Kessler's parents?

- Known: born about 1905 in Wisconsin, according to the 1940 census. His
  daughter Ruth remembers that he was born in Madison, and believed his
  parents came from Germany.
- Unclear: their names, and where in Germany they came from.
- Records that could help: his birth or baptism record; the 1910 and
  1920 censuses, which give parents' birthplaces; his parents'
  naturalisation papers.
- Value: high. It opens the Kessler line.
```

### Records to request: research/requests.md

Add a request only when a chapter or a question needs it. The file is a
table, with one row for each record:

| Column | What it holds |
|---|---|
| Record | What the record is, whose, and its date |
| For | The id of each person it concerns |
| Where to ask | The register office, archive, website or relative that holds it, with any reference you have. Check the reference: the last number is not always a page |
| Cost | The charge, or "Check current fees" until you have checked it |
| Why | What it would confirm or change. Do not assume the answer in advance |
| Status | Such as to ask, asked, ordered or received |

Keep the row until the record arrives and is added to the tree. Then
delete it, and note the record in that session's log entry. Keep
subscription-only lookups next to each other, with the site in "Where to
ask". The list shows when a subscription is worth taking.

A request that needs more room keeps its row. Add a section below the
table, headed with the record. Use it for what to look for, with the
spelling variants; what to save, usually the full page of the original
and the index entry; and what you hold already. Delete the section with
the row. An example, from the sample family:

```markdown
| Record | For | Where to ask | Cost | Why | Status |
|---|---|---|---|---|---|
| Copy of the 1922 marriage entry, Thomas Henry Treloar | `mary-treloar` | Iowa County Register of Deeds | Check current fees | Should name Mary's parents | To ask |

## Copy of the 1922 marriage entry, Thomas Henry Treloar

- Look for: Thomas Treloar and Mary; try Trelore and Treloare. Thomas was
  born at Mineral Point and lived there in 1930, so start with Iowa
  County, Wisconsin.
- Save: the full register page and the index entry.
- Already held: an undated typed list that names her only as Mary.
```

## Working with AI assistants

### Habits that keep an assistant honest

1. **An empty result is not an answer** until you know the search ran as
   you meant. Check that the filters applied, that the collection covers
   the place and the years, and that the site or tool actually responded.
   A tool that failed can also print nothing.
2. **Report only what you can see.** Before the log says "added Olaf's 1900
   census", open the tree and confirm the citation is there. The same holds
   for "saved", "ordered" and "fixed".
3. **What the assistant knows from training is a claim** until a record
   supports it, historical background included. Find a source for it or
   leave it out. A story's `context_years` setting stops a warning about a
   year. It does not make the year right. Never silence a warning to get
   past a statement the records do not support.
4. **Review before milestones.** Before you call a chapter final, share an
   edition with the family, or print, ask independent reviewers to check
   it (see [review.md](review.md)).
5. **Fix kinds of mistake.** When you find a mistake, ask what kind it is
   and look for others of that kind. If one census age was misread, check
   the other ages from the same session. If a phrase of your research
   shorthand reached a caption, add it to `text_checks.errors` in
   `flyleaf.json`. `flyleaf coverage`, `flyleaf deploy` and
   `flyleaf site build` for a public site then catch it. `flyleaf book`
   does not read this list (see
   [family-folder.md](family-folder.md#smaller-settings)).
6. **Keep checks in proportion.** A routine change needs `flyleaf book`, a
   look at the result, and a commit. Record routine work as a commit and a
   line in `PLAN.md`. Keep heavy review for milestones.

### What to ask an assistant for

Ask the assistant to work with words: draft a story from records you give
it, abstract a deed, tabulate census entries, compare two transcriptions.
Do not ask it questions you would type into a search engine, such as "Who
were Olaf Solberg's parents?" Asked about an obscure person, a model can
write a complete, plausible and entirely invented life.

- Ask it to quote the exact words from the record behind each claim, so
  you can check them.
- Open every citation, web address and record it gives you before you
  accept it. Models can invent them.
- Check what a summary leaves out, as well as what it says.

### Ways assistants go wrong

| What happens | Example | Guard |
|---|---|---|
| An invented life | Asked about an ancestor, it writes a biography with no basis | Give it the records, and ask it to work only from them |
| Two people merged into one | Two men of the same name and age become one | Two points of agreement for every record |
| Relationships reversed | Parent and child swapped in a deed abstract | Check every relationship against the text and the tree's family links |
| Names drift | "Tamsin" becomes "Tamsyn" by the end of a session | Re-read the records; read `flyleaf coverage` warnings |
| Old spelling modernised | "perfict" becomes "perfect" | Ask for the record's own spelling; compare with the image |
| Lines skipped | A witness's line vanishes from a transcription | Count lines against the image |
| Names and numbers misread | 1868 read as 1863 | Check every name and number against the image |
| A wrong place | "412 Elm Street NE" read as Nebraska | Confirm every place it expands from an abbreviation |
| A fact inferred | A draft card taken as proof of military service | Ask what the record actually shows |
| A false correction accepted | You say a fact; it agrees without evidence | Ask it to point to the record line before it changes anything |
| Facts dropped in a long session | Details from early in the conversation vanish | Small working sets; fresh records for each task |

### Long sessions

- Keep the material small. Work on one family at a time. As a
  conversation fills up, models drop facts and invent others.
- Start a fresh conversation for a new task where you can. In a long
  session, give the assistant the records again before each piece of work.
- Give it a structure it handles well. Models can misread GEDCOM's
  nesting. An ancestor table is easier, because the numbers carry the
  relationships. `book/COVERAGE.md` lists every ancestor with their number.

### Saying how you used AI

- In the book's note on methods, say which tools you used and for what,
  and that the conclusions are your own after checking the records. See
  [style-guide.md](style-guide.md) on front matter.
- In the citation note of an AI-assisted transcription or translation,
  give the tool and its version, the date, and that a person checked it
  against the image.
- Say so when an assistant wrote substantial text or helped with analysis.
  Help with spelling and searching needs no note. Where an assistant helped
  with analysis, a reference note can name the tool and its version, the
  company, what you asked it, who asked, the date, and the documents you
  gave it.
- Professional bodies are setting their own rules. The Board for
  Certification of Genealogists limits AI use in work submitted for
  certification; read its current rules if you apply. Some publishing
  services ask you to declare AI-generated content.
- Online trees increasingly hold unchecked text written by machines. Post
  to a public tree only facts you have checked against records.

### Several assistants at once

Several assistants can work at the same time on separate tasks. Use them
for:

- **Review panels** before a milestone: separate reviewers check the facts
  against the tree, the evidence against the standards, and the prose
  against the style guide. [review.md](review.md) gives the lenses and the
  prompts.
- **Research spread across separate tasks** that touch different files:
  reading a long source volume by volume, searching censuses for several
  families, gathering pictures.
- **Writing that creates new files only,** such as a first draft of the
  open-questions chapter.

Tell each one which files it may change, so they cannot damage each
other's work:

- One writer for the tree and for existing stories: the main session.
- Researchers return reports as new files, in a folder you name, such as
  `research/reports/`. They save images in their own folder under
  `images/`, such as `images/research/census-search/`. The website leaves
  out files in folders named `research`, `review`, `working` and a few
  others, unless the tree gives a file a `_KIND` and a `_SHA256`
  (`site.research_folders` in [family-folder.md](family-folder.md)).
- Writers create new files only.
- Only the main session commits.
- Name in each helper's instructions the files and folders it may change.

Write each helper's instructions so they stand alone:

- the family folder, the files to read, and the guides to read first;
- one concrete result, with the file name to write it to;
- the files and folders it may change;
- how to report back when done.

Ask reviewers to quote the exact words they question, give each finding a
severity and a suggested fix, and edit nothing.

A helper's final message can go missing. Ask each one to write its report
to a named file as well. If nothing arrives within about half an hour of
when you expect it, look for the file.

Do not use a helper for a single-file edit. Give work in a browser to one
assistant at a time, since a browser can do only one thing at a time.
