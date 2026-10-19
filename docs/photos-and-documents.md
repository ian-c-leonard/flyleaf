# Photographs and documents

A family history rests on its originals: the photographs, letters,
certificates, register pages and newspaper notices behind every fact and
picture. This guide covers how to scan and save them, how to name and file
them, how to make the versions the book needs, how to caption and identify
what they show, the rights involved, and how Flyleaf finds and publishes
them.

- [Two rules first](#two-rules-first)
- [Scanning](#scanning)
- [Saving records you find online](#saving-records-you-find-online)
- [File names and folders](#file-names-and-folders)
- [Recording where each file came from](#recording-where-each-file-came-from)
- [Crops and plates](#crops-and-plates)
- [Captions](#captions)
- [Identifying people in photographs](#identifying-people-in-photographs)
- [Rights and permissions](#rights-and-permissions)
- [Preparing images for print](#preparing-images-for-print)
- [How Flyleaf finds and publishes files](#how-flyleaf-finds-and-publishes-files)

Related guides: [research-standards.md](research-standards.md#saving-your-sources)
for which sources to save and how to judge them,
[relatives.md](relatives.md) for borrowing family papers,
[style-guide.md](style-guide.md#illustrations) for choosing and placing
pictures in the book and for the look of captions, and
[gedcom.md](gedcom.md#files) for the tags.

## Two rules first

1. **Keep the whole original, unchanged.** The whole page, the whole
   photograph with its mount, the whole PDF. Never edit it, and never save
   over it.
2. **Make every other version from it, as a new file, and record how.** A
   crop for the book, a greyscale copy, a smaller copy for the web: each is a
   new file with its own name, and a note of what was done.

With both in place, anyone can check any picture or claim against the
original later, and you can always make a better version.

## Scanning

### Resolution

- **Documents and photographs: at least 300 dpi** (dots per inch)
  (Stratton and Hoff, ch. 8).
- **Photographs: 600 dpi** as your usual setting. It lets you print a
  picture at twice its original size.
- **Small originals need more.** Work it out:

  > scan dpi = printed width in inches × 300 ÷ original width in inches

  A snapshot 2.5 inches wide, printed across the 4.35-inch text column of a
  6 × 9 book, needs 4.35 × 300 ÷ 2.5 = 522 dpi: scan it at 600. A wallet
  photograph 1.5 inches wide needs 870 dpi: scan it at 1,200.
- **Negatives and slides** need a film scanner, or a flatbed with a film
  holder, at 2,400 dpi or more.
- **What a scan allows:** its width in pixels divided by 300 is the widest it
  will print at full quality, in inches. A scan 1,200 pixels wide prints 4
  inches wide.

### Colour

- **Scan in colour, even black-and-white photographs and documents.** Colour
  keeps the subtle tones of an old print, faded ink, pencil notes and the
  difference between two inks. Make a greyscale copy later, as a new file.
- 24-bit colour is enough for most work.

### File formats

- **Masters:** TIFF is best: it keeps every detail. A high-quality JPEG is
  acceptable (Stratton and Hoff, ch. 8). PNG also keeps every detail.
- **Never edit and re-save a JPEG master.** Each save throws away a little
  more detail.
- **Phone photographs** often come as HEIC. Keep the HEIC file as the
  original, and make a JPEG copy to show. Flyleaf offers HEIC and HEIF files
  in the archive as downloads only, because browsers cannot show them.
- **For the book and the website's album**, make JPEG or PNG copies (see
  [How Flyleaf finds and publishes files](#how-flyleaf-finds-and-publishes-files)).

### Scanner settings

- Turn off automatic colour restoration, dust removal, sharpening and
  "descreening" when you scan a master. They change the original. Do any
  cleaning on a copy.
- Scan the area around the item, so its edges, borders and mount show. Do
  not crop in the scanner.
- Keep the glass clean, and handle originals with clean, dry hands.

### Backs, mounts and albums

- **Scan the back of every photograph, postcard and card**, even when it
  looks blank. Pencil can be faint, and the back often carries a name, a
  date, a studio's stamp or a printer's mark. Name the pair with `-front`
  and `-back`.
- **Scan photographs in their mounts and card frames.** The studio's name
  and town are often printed on the mount.
- **Scan the whole album page first**, then each photograph on it at full
  resolution. Keep the order of the pages. A caption written beside a
  photograph belongs with it.
- **Note what is written where**: on the back, on the mount or on the album
  page, and in whose hand, if anyone knows.

### Items too big or too fragile for a scanner

- **Photograph them.** Hold the camera square to the item. Light it evenly
  from two sides, with no flash glare. Fill the frame. Put a ruler beside
  it when size matters.
- **Large maps and certificates:** take overlapping sections, plus one view
  of the whole.
- **Bibles:** photograph the family register pages and the title page,
  which gives the year the Bible was printed. Do not press an old binding
  flat.
- **Objects** such as samplers and engraved watches: photograph the whole
  object, then each inscription close up.
- **Gravestones:** photograph each family stone whole, then the inscription
  close up, with light across the face if it is worn. Add one wider view
  that shows where the stone stands.

## Saving records you find online

[research-standards.md](research-standards.md#saving-your-sources) sets out
what to save and when: record images at full resolution, web pages as PDF,
the whole source when the whole is available, and only within each site's
terms. It also covers checking what you saved and what to do when a page
disappears. For pictures and scans, add these:

- **Download the file the site offers**, at its full size. Take a screenshot
  only when there is no download, and record that the file is a screen
  capture. Say in the provenance which kind of copy you hold: the
  provider's own file, a capture of what the browser showed, or a page
  rendered from a PDF.
- **Keep the repository's numbers**: the image, film, page or catalogue
  number. Put them in the file name or the provenance record, so you can
  find the original again.
- **Save the largest copy.** Some sites offer an image in several sizes, or
  the same page in two scans. Save the largest. When two copies differ,
  such as one showing more of the page's edge, keep both.
- **Newspapers:** find the article on a small overview of the whole page
  first. Then crop it from the full-size page. A newspaper site's own
  clipping tool also works, when it lets you select the article exactly.
  Save the whole page as well as the clipping.
- **Look at the images, not only the text.** Text taken from an ebook or by
  OCR (software that reads printed text from an image) can leave out
  captions and tables printed as pictures. Before you decide that a source
  says nothing about your question, look at its page images.
- **Save web pages as PDF.** A static Flyleaf site publishes HTML files as
  plain text, so a reader would see the page's code.

## File names and folders

### Everything goes in images/

Flyleaf reads photographs and documents only from the family folder's
`images/` folder. The name is fixed: `paths.images` in `flyleaf.json` cannot
change it. The tree points at each file by its path from the family folder,
such as `images/photographs/john-penhallow-portrait.jpg`.

### Folders

Group files by kind, as the sample family does:

| Folder | What goes in it |
|---|---|
| `photographs/` | Portraits, snapshots, groups, houses and places |
| `documents/` | Certificates, register pages, census pages, deeds, wills |
| `newspapers/` | Whole newspaper pages and clippings |
| `letters/` | Letters, postcards and diaries |
| `recipes/` | Recipe books and cards |
| `web-pages/` | Web pages saved as PDF |
| `books/` | Public-domain books and pages, saved whole |
| `…/plates/` | The book's versions, beside the originals they come from |
| `…/working/` | Reading crops, enlargements, failed attempts and provenance notes |

Grouping by where the file came from (census, vital records, military,
newspapers) also works. Choose one scheme and keep to it.

### Names

Use this pattern:

    <date>-<surnames and given names>-<what it is>-<place or collection>.<extension>

From the sample family:

    documents/1866-penhallow-trembath-marriage-certificate.pdf
    newspapers/1912-03-07-iowa-county-lantern-penhallow-obituary.pdf
    letters/1944-04-09-edith-penhallow-to-robert.pdf
    newspapers/plates/1912-03-07-iowa-county-lantern-penhallow-obituary-plate.jpg
    photographs/john-penhallow-portrait.jpg

And some invented ones:

    photographs/1925-ellery-ann-garden-front.jpg
    photographs/1925-ellery-ann-garden-back.jpg
    newspapers/1931-05-02-ashcombe-courier-p7-ellery-wedding.jpg

Rules:

- **Lower case, hyphens instead of spaces, plain ASCII letters and digits.**
  No parentheses, accents or other punctuation. In the book, `#fig` accepts
  only letters, digits, dots, underscores, hyphens and slashes in a path, so
  a file named otherwise cannot be placed there.
- **Dates as year-month-day**, so files sort in date order.
- **Newspapers:** date, paper, page number, subject.
- **Fronts and backs:** end the names with `-front` and `-back`.
- **Plates:** the original's name with `-plate`, in a `plates/` folder
  beside the original.
- **Never change an original in place.** A changed file gets a new name. The
  tree's `_SHA256` for a file must match it, and a private site's deploy
  stops when a file it has already uploaded has changed under the same name.
- **Some names are refused.** The site build stops when the tree names a
  file inside a folder called `private` or `secrets`, in a file or folder
  whose name starts with `.env`, or with "credential" anywhere in its path.
  Files and folders whose names start with a dot are never published.

### Working files

Reading crops, enlargements, contrast-boosted views, failed attempts,
captured search results and provenance notes are working files. Put them in
a folder called `working` inside the folder they belong to.

The site leaves out every file in a folder named `research`, `review`,
`working`, `capture`, `captures`, `correlation` or `independent-reading`,
at any depth. The exception is a file the tree gives a `_SHA256` and one of
the kinds the site knows, such as `photograph`, `document`,
`newspaper-page` or `transcription`. Set your own folder names with
`site.research_folders` ([family-folder.md](family-folder.md)).

### Large files and backups

- Whole scanned books and large TIFF files can stay out of git, with
  `.gitignore`, as long as the tree records each one's `_SHA256` under its
  `FILE` line. Deploy prints the line to add. See [hosting.md](hosting.md).
- Keep at least two copies of every original, one of them away from your
  computer.

## Recording where each file came from

### What to record

For every original:

- **what it is**: the kind of item, its date, how many pages;
- **who holds the original**: the person, or the repository with its call
  number, film number, image number or page;
- **how you got your copy**: scanned by whom and when, or downloaded from
  which site on which date;
- **what kind of copy it is**: your own scan, the provider's own file, a
  screen capture, or a page rendered from a PDF;
- **its size in pixels and its checksum**, from `shasum -a 256 FILE`.

For every file made from another:

- **its parent**: the file it was made from;
- **what was done**: the crop rectangle in pixels (left, top, right,
  bottom), any rotation, greyscale conversion, change of size or file type;
- **what was not done**, when it matters: no sharpening, no retouching;
- **why it was made**: a plate for a story, a reading aid.

### Where to record it

- **In the tree.** Attach each file to its source with `OBJE` and `FILE`.
  This example is adapted from the sample:

      1 OBJE
      2 FILE images/newspapers/1912-03-07-iowa-county-lantern-penhallow-obituary.pdf
      3 FORM pdf
      3 TITL John Penhallow's obituary, 1912
      3 _KIND newspaper-page
      3 _NATURE Single column, with the dateline at the top. 1 page.
      3 _SHA256 61b79ee85e5c8b670a2a01b9f41f9988bc85afdfd0c1307c47df3ef8b5b726c4
      3 _LOCATOR The Iowa County Lantern, 7 March 1912

  `TITL` names the file, `_KIND` says what kind of item it is, `_NATURE`
  describes the original, `_LOCATOR` says where the original is found, and
  `_PAGE` gives the page a long PDF should open at. Readers see the title,
  the notes, `_NATURE` and `_LOCATOR` on the website's archive page, so
  write them for readers.
- **In a provenance note beside the original**, in its `working/` folder:
  the full record of how you got the file, the crop rectangles, the checks
  you made. The site leaves it out.
- **In `data/representations.json`**, optionally, so the website can show
  which file was made from which, such as a crop and its original. The
  provenance note is enough without it
  ([gedcom.md](gedcom.md#other-overlay-records)).
- **In a picture log** for the book (Stratton and Hoff, ch. 8): for each
  picture you might use, the file name, the caption, the source, where it
  goes in the book and whether you have permission. Keep it in a file of
  your own, such as `research/picture-log.md`.
- In the older `[Source]` note format, a clause such as
  ` — image archived images/x.jpg` records where your copy is. It never
  prints ([gedcom.md](gedcom.md#sources-and-citations)).

## Crops and plates

### Two steps for every record image

Handle every record image you capture, whether a newspaper notice, a
certificate, a census page, a portrait, a gravestone or a book page, in two
steps:

1. **Keep the whole.** Save the full image at the resolution you captured
   it, attach it to its source in the tree, and cite it. This is the
   archive copy.
2. **Make a plate.** A plate is a clean crop of just the part the book
   needs: the headline and text of an article, the household's ruled lines
   and the column headings of a census page, one entry of a register, the
   panel of a certificate. Place it in the story it supports, with a
   caption that credits the source.

Do both in the same session. A whole newspaper page shrunk to a book page
is a grey blur: it is the archive copy, not a plate. The register still
cites the whole image.

### How to crop

- **Cut an exact rectangle from the original's pixels**, and record where:
  left, top, right and bottom, in pixels.
- **Change nothing else in the picture.** Do not enlarge, sharpen, retouch,
  repair, recolour or redraw. Do not fill in damage or tidy a stroke.
  Greyscale conversion and saving as JPEG are the usual changes; record
  them.
- **Keep the whole of what you show**: the tails of letters on the last line,
  the complete caption, the photographer's credit, the column headings.
  Check the edges and the last line by eye after cropping.
- **Call a part a detail.** When the plate shows part of a record, say so in
  the caption.
- **Show any rearrangement.** When you bring a printed heading down to sit
  above a chosen row, or set two columns of an article side by side,
  separate the pieces with visible white gaps and add modern labels. Say in
  the caption that the pieces were arranged for the page.
- **Keep joined photographs separate.** When one plate holds two
  photographs, leave a white gap between them. Each keeps its own credit
  and date.
- **Maps:** label a partial map as a detail. Give enough context to find the
  land: show the whole map, with a labelled box around the enlarged area,
  beside the enlargement. Keep the map's title and boundaries. Check every
  landmark the caption names against the crop.
- **Reading aids stay out of the book.** An enlargement or contrast-boosted
  view made only to read a word is a reading aid. Label it as one and keep
  it in a `working/` folder.
- **Replacing a plate:** give the new one a new name. Keep the old one until
  nothing uses it, and note why you replaced it.
- **Check every crop by eye.** Open it beside the original and compare them
  before you use it. [style-guide.md](style-guide.md#placing-pictures)
  covers checking it again on the printed page.

## Captions

This section covers what a caption says. How captions look on the page is in
[style-guide.md](style-guide.md#captions).

### What every caption says

Give every archival picture a caption that answers:

- **Who.** Name everyone you can identify, left to right and row by row
  ("Back row, left to right: …"). Give full names at first appearance, with
  married women's maiden names. Write "unidentified" for anyone you cannot
  name. The check for research wording warns about that word
  (`flyleaf coverage --wording` lists it). In a caption the warning is
  expected: leave it.
- **What.** What the picture is and shows: a studio portrait, a snapshot, a
  wedding group, a clerk's entry in a marriage register, a gravestone.
- **When.** The date the picture was taken, if known. Write "about 1912" for
  an estimate, and keep the reason for the estimate in your notes. A
  publication date is not the date a photograph was taken: a yearbook's
  year or a newspaper's date says when it was printed. Write "published in
  1937" when that is all you know.
- **Where.** At least the town, and the county or state.
- **Credit.** Who holds the original, and who made it, if known.
- **Where it came from**, when that is interesting: "from Ann Ellery's
  album".

Then ask: if I came across this picture in someone else's book, what would
I want to know?

More rules:

- **Describe; do not argue.** The evidence for an identification belongs in
  the citation and your notes, not in a long caption.
- **Say exactly what the picture shows.** A clerk's copy of names in a
  register shows the clerk's handwriting, not the couple's signatures. A
  photograph of a painting is a photograph of the painting. A gravestone is
  a memorial: it does not prove that the person is buried beneath it.
- **Say when a picture only illustrates.** The sample's photographs are real
  Library of Congress pictures of unidentified people and places, standing
  in for the sample family. Every caption and note says so. Never let a
  stand-in picture pass as a member of the family.

### Credits

- **Print real names**: the photographer or studio ("Photograph by …"), the
  institution, in the form it asks for ("Courtesy of …"), and the family
  collection ("Collection of Margaret Ellery").
- **Do not print online account names.** A picture someone posted on an
  online tree or a memorial website under an account name is credited as
  "shared on an online family tree" or "contributed to a memorial website".
  Keep a real-name photographer credit if there is one. Keep the account
  name in your notes, so you can find the picture again. See
  [research-standards.md](research-standards.md#photographs-shared-by-other-researchers).
- **Put credits in each caption, or in a list of picture credits in the back
  matter, or both** (Stratton and Hoff, ch. 8).

### Captions in Flyleaf

- **In the book**, the caption is the text in
  `#fig("photographs/file.jpg", caption: "...")`. A year in a caption is
  checked like a year in the story: `flyleaf coverage` warns when the
  caption gives a year without a citation, and when the year is not in the
  records of the story's people or in its `context_years`. A line
  `// cite-lint: ok figure caption — <reason>` just above the picture quiets
  the citation warning and every other style warning for that paragraph.
  The year check still runs, and so does the check for research wording.
  The sample does this for each of its pictures.
- **On the website's album**, `TITL` is the caption. `_CREDIT` and `_RIGHTS`
  appear under "Original captions and credits", `_PUBLIC_NOTE` appears
  beside the picture, and `_OTHER_SUBJECT` names someone in it who is not in
  the tree. `_DISCOVERY_NOTE` is for you: the site does not show it. See
  [gedcom.md](gedcom.md#photographs-on-the-website).
- **On the website's archive**, a file's title, notes, `_NATURE` and
  `_LOCATOR` are shown to readers.
- **Research notes stay out of captions.** The site build stops when a
  photograph's title or note holds a tree pointer such as `@I12@`, or a
  phrase you list in `text_checks.caption_errors`. `flyleaf coverage
  --wording` lists research wording in text readers see.

## Identifying people in photographs

Name a person in a photograph only on evidence. Never guess a face, and
never infer a relationship from a picture.

### What counts as evidence

- A name written on or with the photograph by someone who knew the sitter:
  on the back, on the mount, on the album page. Note whose hand it is and
  when it was written, if anyone knows.
- A printed caption that gives positions ("left to right").
- A studio's or newspaper's caption that names the sitter.
- A relative who was there or knew the person, recorded with their name and
  the date.
- An identical print of the same photograph that is already identified.

These do not count, on their own:

- resemblance to someone in another picture;
- a guess from apparent age, clothing or setting;
- where the picture was kept ("it was in Grandma's box, so it must be her");
- a face-matching program. Its matches are leads to check, not
  identifications.

### Captions, rosters and pages

- **A caption that names a group without positions** says who is in the
  picture. It does not say which face is whose. Do not assign a face.
- **A roster, a list of officers or players, a list of instruments, a
  uniform or a role** (the goalkeeper, the best man) does not identify a
  face.
- **A caption that gives positions** ("third from left, front row") supports
  a probable identification. Count carefully, because rows are often
  uneven. When the count is uncertain, write "probably".
- **On a newspaper page, the portrait beside an article may be someone
  else**, from a neighbouring story. Read each picture's own caption.
- **A yearbook's general photographer credit** does not say who took a
  particular picture.
- **Two people side by side** are not evidence of a marriage or any kinship.
- **A photograph of a house** identifies the building. It does not show who
  lived there, when it was built or whether it was moved, unless a record
  says so.
- **A museum's date or attribution for an object** is the cataloguer's. Give
  it as theirs, and do not infer earlier owners or motives from it.

### When relatives identify a picture

- Show the picture. Ask who is in it, where and when it was taken, and how
  they know. Record the answer with their name and the date: it is
  testimony ([relatives.md](relatives.md#weighing-what-relatives-tell-you)).
- When two relatives disagree, keep both identifications in your notes until
  evidence settles it.
- Write identifications in your records and on copies. Write on an original
  only with the owner's agreement, in soft pencil on the back.

### Recording certainty in Flyleaf

The website's overlay tags say how sure you are, and the site shows the
difference ([gedcom.md](gedcom.md#photographs-on-the-website)):

| Tag | Use it for | What the site does |
|---|---|---|
| `_SUBJECT @I…@` | A person identified from evidence | Shows the picture on their page under "Photographs and portraits" |
| `_CAPTION_PERSON @I…@` | A person a caption names, when you cannot say which face is theirs | Shows a group picture on their page under "Group photographs", which says "Named in the caption. We may not know who is who." |
| `_QUALIFIED Y` | An identification that carries doubt | Labels the picture a "Related photograph" (a "Group photograph" when it is a group with people named in its caption), keeps it out of the album's section of identified family pictures, and lists it on a person's page under "More pictures" |
| `_RELATED @I…@` | A person the picture belongs with who is not in it, such as the family who lived in a house | Lists it on their page under "More pictures", which says they may not be in the picture |
| `_OTHER_SUBJECT` | Someone in the picture who is not in the tree, in words | Shows "Also in the photo:" with the words |
| `_AVATAR Y` | A person's profile picture | Allowed only on a portrait with exactly one `_SUBJECT` and no `_QUALIFIED`. The build stops otherwise. |

## Rights and permissions

Owning a photograph is not the same as owning its copyright. The
photographer, the studio or their heirs may hold the copyright in an old
portrait, so it is often not in the public domain. This section is general
guidance, not legal advice.

### When you need permission

Following Stratton and Hoff (ch. 8), you need permission for:

- recent studio photographs;
- pictures of living people (tell them, and ask);
- photographs borrowed from relatives (an emailed yes is enough; keep it);
- material published after the public-domain line (below);
- images held by a library, archive or museum: follow its terms and use
  its credit line.

A relative's yes covers their own agreement. It does not clear the
copyright in a picture a photographer or a studio made. Check that against
the public-domain line below.

You usually do not need permission for:

- material published before the public-domain line;
- works of the United States federal government;
- your own photographs.

### The public-domain line moves every year

- **In the United States, a published work enters the public domain 95
  years after publication**, on 1 January. In 2026 that covers works
  published in 1930 or earlier. The line moves forward one year every
  1 January. Older guides give an earlier date, so check the current year
  before you borrow text or pictures.
- **Some later publications are also free**, such as works published before
  1978 without a copyright notice, or published before 1964 without a
  renewed copyright. Check before you rely on this.
- **Unpublished works follow different rules.** Most family snapshots,
  letters and diaries were never published. In the United States they are
  generally protected for the creator's life plus 70 years, or 120 years
  from creation when the creator is unknown. A very old snapshot can still
  be in copyright.
- **Other countries differ.** Many protect a work for the creator's life
  plus 70 years. Check the rules where the work was made and where you will
  publish.
- Cornell University Library publishes a chart, "Copyright Term and the
  Public Domain in the United States", that sets the rules out by date.

### Pictures from websites and repositories

- **Repositories' terms.** A library or archive can set terms for using its
  scans, even of public-domain items. Follow them and use its credit line.
  Check the rights statement on each item. Many Library of Congress items
  say "no known restrictions on publication"; the sample family's pictures
  are such items.
- **Search by usage rights.** Image searches can filter by licence
  (Stratton and Hoff, ch. 8). Wikimedia Commons and Flickr Commons give the
  licence of each file.
- **Online trees and memorial websites.** A photograph a member uploaded
  belongs to that member or to its true owner. Save it for your research,
  with the credit, and ask before you publish it.
- **Subscription newspaper sites.** Saving a clipping for your own research
  is usually within a site's terms. Publishing it is a separate question:
  read the terms, and check the date against the public-domain line.
- **A private site** limits who can see a picture. It does not change who
  holds the copyright.

### Keep a record

For every permission, record who gave it, for what, on what date and how,
and keep the email. Note the status in your picture log.

### Free sources of pictures

The *Guide* (ch. 8) recommends these, among others: the Library of
Congress Prints and Photographs Division, the David Rumsey Map Collection,
the Leventhal Map and Education Center at the Boston Public Library, the
New York Public Library's Digital Collections, Wikimedia Commons, Flickr
Commons, and state and local historical societies. Check the rights
statement on every item.

## Preparing images for print

[style-guide.md](style-guide.md#choosing-pictures) covers which pictures to
choose and where to place them. This section covers getting each file
ready.

### Resolution at the printed size

- **Aim for at least 300 pixels per inch at the printed size.** The
  effective resolution is the picture's width in pixels divided by its
  printed width in inches.
- **How large Flyleaf prints a picture.** `#fig` sets a picture across the
  full text column: the page width less 1.65 inches of margins, which is
  4.35 inches on the default 6 × 9 page. At 300 ppi that needs 1,305 pixels
  across. A tall picture, more than 1.05 times as tall as it is wide, is
  fitted within the text height less room for its caption: 5.5 inches on a
  6 × 9 page, so 1,650 pixels tall. A different trim size in `book.yaml`
  changes these numbers.
- **To print a picture smaller**, use
  `#figure(image("/images/photographs/file.jpg", width: 2in), caption: [...])`.
  At 2 inches it needs 600 pixels across.
- **When a picture is short of pixels, print it smaller.** Do not enlarge it
  to reach a number: enlarging adds no detail. If a picture you want falls
  below 300 ppi, judge it in a printed proof before you accept it.

### Greyscale and tone

- **For a black-and-white book, convert to greyscale yourself**, as a new
  file. Do not leave it to the printer.
- **Allow for dot gain.** Ink spreads into paper, so prints come out darker
  than the screen. Lift the midtones and shadows a little. A picture ready
  for print can look slightly washed out on screen.
- **Make these changes on the print copy only.** The master stays untouched.
- **Proof.** An office laser print gives a rough idea of tone. Judge the
  real printer's proof, and look at it again after a few days.

### Files for the book

- **Use JPEG or PNG.** The website's copy of the book accepts only those,
  besides Flyleaf's own charts.
- **Save plates as JPEG, greyscale or sRGB, at high quality** (about 92 to
  95), **with no embedded colour profile.** A picture with an unusual
  profile can show as a blank space in some PDF viewers, even though the
  build succeeds. Open the finished PDF in more than one viewer and look at
  every picture.
- **Remove hidden data from photographs you publish.** Phone pictures often
  record where they were taken, which can be a living relative's home. The
  sample's photographs are saved with no metadata: no camera data, location,
  colour profile or comments.
- **Make every book picture a file the website publishes.** The website's
  copy of the book uses the same files, and the site build stops when a
  book picture is not one of the site's files. In practice, attach each
  plate to its source in the tree with `OBJE` and `FILE`, as the sample
  does, and keep it out of the research folders.

### Proofs

Order a printed proof before a family print run, and judge the pictures on
paper. [review.md](review.md) covers the checks before printing.

## How Flyleaf finds and publishes files

### The book

- `#fig("photographs/file.jpg", caption: "...")` looks for the file first
  among Flyleaf's generated charts in `build/figures/`, then in `images/`.
  The book build stops when it cannot find the file.
- A picture more than 1.05 times as tall as it is wide is set as a tall
  picture, capped in height (see
  [Preparing images for print](#preparing-images-for-print)).
- `#figure(image("/images/…", width: …), caption: [...])` sets a size or
  cites a source in the caption ([book.md](book.md)).

### The website's album

A photograph in the album, or used as a person's picture, needs its own
`OBJE` record in the site overlay, `site/edition.ged`, with `FILE` and one
`_SHA256`, `TITL`, `_CONTENT`, `_ALBUM` and `_VISUAL_ROLE`. The file must be
a `.jpg`, `.jpeg`, `.png`, `.webp` or `.gif` under `images/`, with only one
such record. The build stops, naming the problem, when a required line is
missing. See [gedcom.md](gedcom.md#photographs-on-the-website).

### The website's archive

The site publishes only files that the tree or the overlay names: a `FILE`
under an `OBJE`, or an `_ARCHIVE` line under a source in the overlay. Site
content files, such as `albums.json`, can only use files named that way. A
file in `images/` that nothing names stays private. The archive page lists
the sources and pictures you name in the overlay's catalogue
([gedcom.md](gedcom.md#other-overlay-records)).

| Kind | Extensions | What the site does |
|---|---|---|
| Pictures | `.jpg` `.jpeg` `.png` `.webp` `.gif` `.tif` `.tiff` | Shows them. The build makes browsing copies (WebP, at most 640 and 1,600 pixels on the longer side) and never changes the original. |
| Phone pictures | `.heic` `.heif` | Offers them as downloads. Add a JPEG copy to show the picture. |
| Documents | `.pdf` `.epub` `.txt` | Offers them. `_PAGE` opens a PDF at a page. |
| Saved web pages | `.html` `.htm` | Offers them. A static site publishes them as text files. |
| Recordings | `.mp3` `.m4a` `.aac` `.ogg` `.oga` `.opus` | Plays them. |
| Original audio | `.wav` `.flac` `.aif` `.aiff` | Offers them as original audio. |
| Notes and data | `.md`, `.xml`, `.json` | Only with a `_SHA256` and a matching `_KIND`: `transcription` or `research-note` for `.md`; `finding-aid` for `.xml`; `record-index`, `record-extraction`, `catalogue-record`, `research-note` or `search-capture` for `.json`. |

A static site publishes saved web pages and XML files as text files, so a
browser cannot run them.

The site leaves out, and lists with the reason in
`build/site-data-report.json`:

- files outside `images/`;
- paths on one computer, such as `C:\…` or `/Users/…`: copy the file into
  `images/` and point the tree at it;
- hidden files and folders, whose names start with a dot;
- kinds of file the site cannot show;
- files in research folders, unless the tree gives them a `_SHA256` and a
  kind the site knows.

It stops on a path with a folder named `private` or `secrets`, a name
starting `.env`, or "credential" anywhere.

### Checksums

- When a `FILE` or `_ARCHIVE` line carries a `_SHA256`, the site build
  checks the file against it and stops if they differ. After you replace a
  file, give it a new name and record its new checksum.
- Album photographs must carry one. `shasum -a 256 FILE` prints it.
- A file kept out of git must carry one (see
  [Large files and backups](#large-files-and-backups)).

### Static and private sites

- **A static site is public.** Everything it publishes, every document
  included, is open to anyone with the address. When the site leaves out a
  person, such as someone marked private, it drops the link between a
  photograph and that person, but keeps the photograph and its caption.
  Check pictures and captions of living people yourself. See
  [hosting.md](hosting.md#a-static-site) and
  [relatives.md](relatives.md#what-to-publish-about-living-people).
- **A private site** keeps originals in a private Cloudflare storage
  bucket. Deploy stops if a file it already holds has changed under the same
  name: give the changed file a new name. See [hosting.md](hosting.md).
