# Working with living relatives

Living relatives know things no archive holds: how a couple met, what a
grandmother's kitchen was like, where the family Bible went. Many of them
also hold papers and photographs. This guide covers how to ask for all of
it, how to record it, how to cite it, and what to publish about the people
who are still alive.

- [Before you contact anyone](#before-you-contact-anyone)
- [Telling relatives what will be published](#telling-relatives-what-will-be-published)
- [Questionnaires](#questionnaires)
- [Interviews](#interviews)
- [Family papers](#family-papers)
- [Scanning at the visit](#scanning-at-the-visit)
- [Weighing what relatives tell you](#weighing-what-relatives-tell-you)
- [Citing family sources](#citing-family-sources)
- [What to publish about living people](#what-to-publish-about-living-people)
- [Relatives on a private website](#relatives-on-a-private-website)
- [After an edition](#after-an-edition)

Related guides: [research-standards.md](research-standards.md) for how to
judge evidence, [photos-and-documents.md](photos-and-documents.md) for
scanning and captions, [style-guide.md](style-guide.md#citations) for the
form of citations in the book, and [review.md](review.md) for checks before
you share an edition.

## Before you contact anyone

### Who to ask first

- Start with the oldest relatives. Their memories reach furthest back.
- Then find whoever kept the family's memory: the one who wrote the
  Christmas letters, kept the albums or went to every funeral. Ask each
  relative, "Who was the family historian before you?"
- Ask about every branch, including branches that are not your own line.
  A cousin on another branch may hold the other half of a story, or the
  photographs your side never had.
- Ask each relative who else you should ask, and whether you may pass a
  questionnaire on to them.
- Keep the list in `PLAN.md`, with what you hope each person can answer.
  Papers you want to see go in `research/requests.md` until they are
  scanned and cited.

### The order that works

1. **Send a questionnaire first.** It gives the relative time to think and
   to look for papers.
2. **Read the answers.** Plan a conversation around what they said and
   what they left out.
3. **Talk.** By phone, by video or in person. In person is best when there
   are papers or photographs to see.
4. **Scan papers and photographs at the visit**, while the owner is there
   to say what each one is.
5. **Write it up the same week**: new facts into the tree with citations,
   new questions into `research/questions.md`, and an entry in
   `research/log.md`.

### When an assistant helps

- The assistant can draft the cover note, the questionnaire, interview
  questions, transcripts and citations.
- The person makes the contact. The assistant asks before it sends anything
  to a relative or contacts anyone on the person's behalf.
- The assistant never puts a living relative's address, phone number, email
  address or employer into the tree.

## Telling relatives what will be published

Tell every relative, before they answer anything, that what they share may
be published in a family history (Stratton and Hoff, ch. 4). They can then
decide what to share.

Say plainly:

- **What you are making**: a book, a website, or both.
- **Who will see it.** A static Flyleaf site is public: anyone who has the
  address can read all of it. A private site shows everything to every
  relative you invite. A printed book gets passed around, and you may give
  copies to libraries. See [hosting.md](hosting.md).
- **That they may skip any question**, and that they should tell you
  anything that must stay out, especially about a living person.
- **That you will credit them** by name for what they give, unless they
  would rather not be named.
- **That you will show them their own entry** before you share an edition,
  if they would like to see it.

Ask separately for each of these, and keep the answer:

- recording an interview;
- scanning their photographs and papers;
- publishing each scanned item, in the book and on the website (an emailed
  yes is enough; keep the email);
- quoting their own words in the book.

A relative's yes covers their own agreement. It does not clear the
copyright in a picture made by a photographer or a studio. See
[photos-and-documents.md](photos-and-documents.md#rights-and-permissions).

Keep a record of each permission: who agreed, to what, on what date, and
how (the email, or the time on the recording where they said yes). Keep it
in a file of your own in the family folder, such as
`research/permissions.md`. Do not put it in a source note: the website shows
source notes to readers.

When a living relative asks you to leave out something about themselves,
leave it out, even when a public record shows it.

A relative may withdraw their agreement later. Remove what they ask from
the website, and from the next edition of the book. Tell them when they
first agree that copies already printed cannot be called back.

## Questionnaires

A questionnaire suits relatives who like time to think, and those who live
far away. It also prepares an interview: you arrive knowing what to ask.

### What Flyleaf writes

    flyleaf questionnaire ruth-kessler

writes a questionnaire for one relative, built from the tree. The argument
is the relative's id in the tree (their `REFN`). The file is
`questionnaires/questionnaire-<id>.md` in the family folder. It is plain
Markdown: edit it, then print it, paste it into an email or turn it into a
document. Running the command again replaces the file, so make your edits
in a copy.

The command needs your name as `maintainer.name` in `flyleaf.json`,
because the form ends by asking for replies to you.
`flyleaf new --maintainer "Your Name"` sets it. Without it, the command
stops and writes nothing.

The file opens with a notice, then has four sections:

- **The notice** says the information may be published in the book, which
  it names from `book/book.yaml`, and on the family's website. It asks the relative to share only what
  they are comfortable seeing in print, and to say what should stay out,
  especially about a living person.
- **1. What our records already say.** The tree's facts for the relative,
  their parents and their four grandparents, for them to correct, and the
  names of their brothers and sisters. Each line gives birth and death
  dates and places, and each partner: "married" with the date when the tree
  records a marriage, "partner of" when it links a couple without one. A
  grandparent the tree does not name appears as "unknown to our records:
  can you name them?" Reading the record often brings back a memory.
- **2. The memory questions**, in seven groups that move from easy to hard:
  their earliest world, the people, work and choices, love and family, the
  harder years, things and places, and a closing group "for the record".
  Every question is open, with follow-up prompts under it. Where the tree
  allows, the questions name real people and places: the town where the
  relative was born, each grandparent who was alive in their lifetime, and
  each partner ("Tell me about the day you met ..."). A grandparent who
  died before the relative was born gets a different question: what were
  you told about them, and by whom?
- **3. Questions only you may be able to answer.** Sentences from the notes
  of the relative and their ancestors, back to their great-grandparents,
  that mark an open question: `[TODO]`, `TODO:`, `OPEN:`,
  `INVESTIGATE NEXT:`, "needs research", or "not yet found", "not yet
  known", "not yet determined" or "not yet identified". It leaves out the
  notes of anyone else on those lines who may be living. Then one question
  for each parent or grandparent whose father or mother the tree does not
  name.
- **4. Photographs and papers.** A request to scan family photographs,
  certificates, letters and clippings (300 dpi, in colour), a request for an
  emailed OK to publish, and a promise that every image is credited. It
  ends with the maintainer's name for the replies.

**Living people.** The relative sees their own record in full. Anyone else
on the form who may be living is named with no facts ("may be living: facts
not shown here"). On the other lines, a marriage date to a partner who may
be living is left off. "May be living" follows the same rule as the
website: see [hosting.md](hosting.md#a-static-site).

### Before you send it

1. **Read section 3 line by line.** It prints your own research notes as
   they stand. A note such as `[TODO] Look for his 1912 obituary` becomes a
   question no relative can answer. Rewrite each line as a question the
   relative could answer, or delete it.
2. **Write open questions in the tree as questions a relative could
   answer**, and the questionnaire improves by itself:
   `[TODO] Where was Elizabeth baptised?` works;
   `[TODO] Search the Camborne registers` does not.
3. **Check section 1 for this reader.** It shows the dead in full and the
   relative's own record. Make sure nothing in it would hurt or surprise
   them.
4. **Check what the questions assume.** The memory questions name the town
   where the relative was born and the grandparents alive in their
   lifetime. A relative may have moved away as a baby, or never met a
   grandparent. Reword or remove any question that assumes too much.
5. **Add your own questions** about puzzles on their branch: a story you
   want to hear again, a name you cannot place, a photograph to identify.
6. **Add the cover note** below, and your address, phone or email for
   replies.
7. **Check that the notice suits how you will share.** It says answers may
   appear in the book and on the family's website. If you will make only a
   book, or the website is private, say so in the notice.
8. **Make it easy to answer.** Print it with room to write for relatives who
   prefer paper. Offer to read it aloud on a call: the questionnaire is meant
   to be answered out loud as much as on paper.

### A cover note

Write it in your own voice. It should say who you are, what you are making,
who will see it, that answers may be published, and that every question is
optional. For example:

> Dear Aunt Margaret,
>
> I am putting together a history of the Ellery family: a printed book, and
> a private website that only invited relatives can open. I would love your
> help with it.
>
> The questions below start with what our records already say, so you can
> correct them. Then come questions about your own memories. Please answer
> only what you are happy with. Anything you tell me may be published in
> the book or on the website, so tell me if something should stay out.
>
> If you have photographs, letters or other family papers, I would love to
> scan them. I can come to you, and I will credit every picture.
>
> Thank you,
> Daniel

### Questions to add for a fuller record

When the tree knows little about a relative, add the questions of a
standard family questionnaire (adapted from Stratton and Hoff, appendix B):

- **About you:** your full name (and maiden name); your father's full name;
  your mother's full maiden name; your date and place of birth; your
  schooling (school, college and graduate degrees, with years); military
  service (branch, rank, dates); your occupations.
- **Marriages:** date and place of each marriage; your spouse's full name
  (maiden name for a woman); your spouse's parents' full names, with the
  mother's maiden name. Include divorces and earlier or later marriages.
- **Children,** in birth order: full name, date and place of birth,
  schooling, marriage (date, place, spouse's full name and parents), and
  occupations.

And these memory questions, if the generated ones miss them:

- For each couple you knew: how did they meet? This is the single best
  question to ask about any couple (Stratton and Hoff, ch. 14).
- What do you remember of your parents and grandparents: their houses,
  voices, habits and sayings?
- What family stories did you hear growing up, true or not?
- Who kept a Bible, letters, diaries, albums or scrapbooks? Where are they
  now?
- Which places mattered: the farm, the church, the old neighbourhood? Does
  each one still stand?
- What did this family always do at weddings, reunions, funerals and
  holidays?

### When the answers come back

- Thank the relative promptly.
- Keep the reply as it came: scan a paper form, save an emailed one. It is
  a source.
- Cite it as a questionnaire (see [Citing family sources](#citing-family-sources)).
- Compare each answer with the records. Where they differ, keep both and
  explain the difference in a note.
- Follow up at once on any mention of papers or photographs.

## Interviews

### Prepare

- Read their questionnaire answers. Then read the tree's records for their
  family again, fresh, so you hold the right names and dates in mind.
- Choose a few topics. You will not cover everything in one sitting. Plan
  for more than one session; an hour is plenty for many older people.
- Bring things that prompt memory: copies of records, photographs to
  identify, a simple family chart, a map of the old neighbourhood.
- Ask whether they would like someone else there. Note who is present.
- Test your recorder in the room you will use.

### The questions that work best

Flyleaf's questionnaire follows these rules, which come from oral-history
practice (StoryCorps's lists of questions and the Oral History
Association's guidance). Use them in conversation too.

- **Ask open questions.** "Tell me about ...", "Describe ...", "What was ...
  like?" Avoid questions that can be answered yes or no.
- **Anchor each question to a real day, place, person or object.** "Describe
  the farm near Dodgeville" brings back more than "Tell me about your
  childhood".
- **Follow up two or three times.** The story is usually in the second or
  third answer: "What happened next?", "Why do you think that was?", "Who
  else was there?"
- **Start easy.** Begin with early memories and good times. Come to losses
  and hard years once the relative is at ease.
- **Ask for the senses and the feelings**: what the kitchen smelled like,
  what a voice sounded like, how they felt that day.
- **Ask how every couple met.** It is the best question about any couple
  (Stratton and Hoff, ch. 14).
- **Ask for family stories, true or doubtful.** A story the records
  disprove still makes a good page, told as a story.
- **Ask who kept the family's things**, and where those things are now.
- **Ask how they know.** "Were you there? Who told you?" A memory of
  something they saw is stronger than something they heard.
- **Do not lead.** Ask "Where was she born?" before "Was she born at
  Penzance?" If you read them a record to prompt a memory, note that you
  did, so you know later which details came from you.
- **Close with the large questions**: how would you like to be remembered;
  what would you pass on to the people who read this in years to come; is
  there anything about this family you have never been asked and want on
  the record?

### During the interview

- Start the recording with the date, the place, who is present, and the
  relative's own words agreeing to be recorded and to the recording being
  used in the family history.
- Let them talk. Wait through silences.
- Ask how to spell each new name and place, then or at the end.
- Note the time on the recording when something important comes up.
- Do not correct them. Note what disagrees with the records and check it
  later.
- For each photograph or paper they show you, ask whose it was, where it
  came from, who is in it, and how they know.
- Stop while it is still enjoyable. Come back another day.

### Recording

- Use a recorder or a phone. Record a short test and listen to it first.
- Choose a quiet room. Turn off radios, televisions and fans. Put the
  recorder near the speaker and away from clocks and windows.
- Record a video call only with everyone's agreement, and save the file.
- Keep the original file, unedited, as the master. Make a smaller listening
  copy (MP3 or M4A) from it if you need one.
- Back up the recording the same day, in two places.
- Name it like any other original, date first:
  `2023-03-ruth-solberg-interview-recording-1.m4a`.

On a private site, the archive can play an interview. It plays MP3, M4A,
AAC, Ogg and Opus files, and offers WAV, FLAC and AIFF files as original
audio. Put a recording on the site only with the speaker's agreement. The
site publishes only files the tree or the site overlay names, so a
recording you do not name there stays private. See
[photos-and-documents.md](photos-and-documents.md#how-flyleaf-finds-and-publishes-files).

### Transcribing

- **Transcribe word for word.** Keep the speaker's grammar, local words and
  repetitions. Mark what you cannot hear, with its time:
  `[inaudible, 14:32]`. Mark a guess: `[Trewellard?]`.
- **Label the speakers.** Add the time at each new topic, and at least every
  few minutes, so a reader can find the passage on the recording.
- **Mark spellings.** Show which spellings the speaker confirmed and which
  you guessed.
- **Check a machine transcript against the recording.** A speech-to-text
  program or an AI assistant can make a first draft. Machine transcripts go
  wrong most often on names, places, dates and numbers: the words that
  matter most. They also turn unusual words into common ones, and can drop
  whole passages. Listen to the whole recording against the draft. Check
  every name, place, date and number by ear, and listen for passages the
  draft left out.
- **Record how the transcript was made**: who made it, with which program
  or model, who checked it against the recording, and when. Say so in the
  source's citation when an AI-assisted transcript underlies a fact.
- **Offer the speaker a copy to correct.** Keep their corrections as a note
  beside the original transcript, so both survive.
- **Keep the transcript with the recording.** On a private site, a
  transcript can go in the archive as a PDF or a text file. A Markdown
  transcript needs `_KIND transcription` and a `_SHA256` on its `FILE`
  line.
- **Quote exactly.** In the book, quote the transcript as it stands. Mark
  each cut with an ellipsis. Do not join remarks from different parts of an
  interview into one quotation.

### Write it up the same week

- Add each new fact to the tree, cited to the interview, with the recording
  and the time.
- Put new questions in `research/questions.md`, and papers to ask for in
  `research/requests.md`.
- Add an entry to `research/log.md`.
- Mark the memories that belong in the stories. A remembered detail, told in
  the relative's own words, is often the best line in a chapter.

## Family papers

### Ask for them by name

People forget what they hold until asked about a particular thing. Ask
every relative, by name, about:

- family Bibles, with their family register pages and anything tucked
  inside;
- letters, postcards and telegrams;
- diaries and journals;
- photograph albums, loose photographs, slides, negatives and home films;
- scrapbooks and newspaper clippings;
- wedding books and guest books;
- funeral cards, memorial cards and orders of service;
- deeds, wills, leases and other papers kept in drawers;
- certificates of birth, baptism, marriage, death and naturalisation, and
  military discharge papers;
- school reports, diplomas and yearbooks;
- recipe books and recipe cards;
- objects with names or dates on them, such as samplers, engraved watches
  and trophies.

Ask where things went: "Who has Grandma's papers now?" often finds them.

### Handle them with care

- Look at papers where they are kept, with the owner, unless the owner
  offers to lend them.
- Do not take anything apart. Leave photographs in their albums; do not
  prise out pictures that are glued or stuck in. Scan or photograph the
  whole page.
- Do not write on originals, and do not use tape or sticky notes on them.
- Do not press an old Bible flat on a scanner if the binding might crack.
  Photograph its pages instead.
- Return anything you borrow promptly, as you received it.

### Record where each item came from

For each item, write down at the time:

- what it is, the dates it covers, and its condition;
- who holds it now, and where;
- how it came to them, as far as they know: from whom, and when;
- who made it, as far as anyone knows: whose hand wrote the Bible entries,
  who typed the list;
- when you saw or scanned it, and who did the scanning.

The citation then says who holds it (see
[Citing family sources](#citing-family-sources)). The sample family shows
why this matters. Among Joan Penhallow's papers is a photocopy of an undated
typed list of Treloar names and dates. Nobody knows who typed it, when, or
from what, so it cannot yet be weighed. The sample leaves its kind
`unclassified` until someone finds out.

### Weighing family papers

- **A Bible register is as good as the time its entries were made.** Look at
  the title page for the Bible's printing date. An entry for a birth before
  that date was written later, from memory or from another record. Many
  entries in one hand and one ink were probably written at one sitting. In
  the sample, Edith Penhallow kept the family register from her wedding in
  1907: entries after it were written near the time, and earlier births
  were filled in from memory.
- **A letter is good evidence for what its writer saw and did near its
  date**, and weaker for events long before.
- **A funeral card or an obituary** takes its birth date and family details
  from an informant, often a grieving relative.

[research-standards.md](research-standards.md) explains how to classify and
weigh these sources.

## Scanning at the visit

Full detail is in [photos-and-documents.md](photos-and-documents.md). In
short:

- Bring a flatbed scanner, or a phone with a good camera, and a computer
  with room for the files.
- Scan at 300 dpi at least, in colour, even for black-and-white items. Scan
  photographs at 600 dpi so they can be enlarged, and small snapshots
  higher.
- Scan both sides of every photograph and card. The back often carries a
  name, a date or a studio's stamp.
- Scan the whole item before any detail: the whole album page, the whole
  letter, every page of a Bible's family register.
- Name and log each file as you go, with what it is and who holds it.
- Ask the owner, while you are there, who is in each photograph and how
  they know.
- Give the owner a copy of the scans. It is a good thank-you, and a second
  copy in a second place.

## Weighing what relatives tell you

- **What relatives tell you is a source**, of the kind Flyleaf calls
  `family-testimony`. A person known only from a relative's memory can carry
  the confidence `memoir`, as long as no record contradicts it. See
  [research-standards.md](research-standards.md).
- **Firsthand or heard?** A grandson who remembers his grandmother is a
  firsthand witness to her voice and her kitchen. His account of her birth
  is something he was told. Record which, in a citation note.
- **The sample shows the difference.** Ruth Solberg's 2023 interview gives
  her parents' marriage in 1929, five years before she was born; that
  citation carries `QUAY 2`. Her account of her husband's parents, Olaf and
  Hilda Solberg, carries `QUAY 1`. Olaf is known so far only from Ruth's
  memories, so his confidence is `memoir`.
- **Memory is strongest for what people saw**, and weakest for dates and for
  events before they were born. Family stories also grow as they are
  retold: farms get bigger, ranks rise, surnames acquire noble origins.
  Write the story down as told, with who told it and who told them. Then
  test it against the records.
- **When a memory and a record disagree**, keep both. Explain the conflict
  in a note, and weigh them. A record made at the time usually outweighs a
  memory from decades later, but a clerk can be wrong too.
- **A relative's own online tree is a lead.** Accept a fact from it only
  when you can follow it back to a record.
- **In the book, say whose memory it is.** Write "Ruth remembered ..." or
  "Ruth was told by her mother ...". Do not turn a memory into a flat
  statement of fact. See [style-guide.md](style-guide.md).

## Citing family sources

### The forms

Stratton and Hoff (ch. 5) give simple forms for family sources. Adapted,
with invented examples:

| Source | Form |
|---|---|
| Email | Email from Margaret Ellery to Daniel Ellery, 3 May 2025. |
| Letter | Letter from Margaret Ellery to Daniel Ellery, Bristol, 3 May 2025; original held by Daniel Ellery. |
| Questionnaire | Questionnaire supplied by Margaret Ellery, 3 May 2025. |
| Interview | Margaret Ellery, interview by Daniel Ellery, Bristol, 4 June 2025; recording and transcript held by Daniel Ellery. |
| Family Bible | Ellery family Bible, family register pages kept by Ann Ellery, 1881–1932; held in 2025 by Margaret Ellery. |
| Your own knowledge | Family information supplied by Daniel Ellery, June 2025. |
| A family photograph | Photograph of Ann Ellery, about 1890; original in the collection of Margaret Ellery. |

Each form says who gave the information, when, and who holds the original.
Add the place where it helps. Write "Questionnaire supplied by": Flyleaf
recognises that wording as family testimony.
[style-guide.md](style-guide.md#citations) covers how the book prints
citations.

### In the tree

Make one `SOUR` record for each source: each interview, each questionnaire,
each letter, each email or exchange of emails. Cite it under the fact it
supports. The sample's interview with Ruth Solberg looks like this, without
its sample label and with a citation note added:

    0 @SRC_RUTH2023@ SOUR
    1 TITL Oral history interview with Ruth Solberg, interview by Tamsin Penhallow, Madison, March 2023
    1 ABBR Ruth Solberg interview, 2023
    1 _KEY ruth-solberg-interview-2023
    1 _TIER family-testimony

    0 @F0006@ FAM
    1 MARR
    2 DATE 1929
    2 PLAC Madison, Dane County, Wisconsin, USA
    2 SOUR @SRC_RUTH2023@
    3 PAGE Recording 1, about 04:15: her parents married in Madison in 1929
    3 QUAY 2
    3 _KEY kessler-vogel-marriage-1929
    3 NOTE Ruth was born five years after this marriage. She gives what she was told.

- **`TITL`** uses the form above. `ABBR` is the short title for later notes.
- **`_TIER family-testimony`**: set it on every family source. Flyleaf
  sorts a source without `_TIER` by its title, and tries the other kinds
  first. A letter that mentions a census, or an interview "for the family
  history", lands in the wrong kind, and an email or a letter is not
  recognised at all. The titles Flyleaf does recognise contain "family
  knowledge", "family memoir", "family Bible", "family papers", "oral
  history", "questionnaire supplied" or "interview by".
- **`PAGE`** says where in the source the evidence is: the recording and the
  time, the question number, the page of a letter, the date of an email.
  Add what the speaker said, briefly, as the sample does.
- **`QUAY`** is your judgement of this one citation, from 0 to 3 (see
  [research-standards.md](research-standards.md#citation-quality-quay)).
  Leave it out when you have not judged it.
- **A citation `NOTE`** records a qualification, such as "she was told this
  by her mother". It prints in the book's footnote, so write it for readers.
- **`_KEY`** is a stable name the stories cite (see [book.md](book.md)).

Keep the scan of the returned questionnaire, the saved email, or the
recording and transcript. Attach a file to its source with `OBJE` and
`FILE` only if the relative agreed to share it, because the website can
show attached files (see
[photos-and-documents.md](photos-and-documents.md#how-flyleaf-finds-and-publishes-files)).

## What to publish about living people

### The rules

Write about living people only from public records and from what they
chose to share with you.

- **Births: the year only.** The sample gives every living person's birth as
  a year.
- **Leave out** current addresses, phone numbers, email addresses,
  employers, the town they live in now, and social-media profiles.
- **Do not take facts** from social-media or professional profiles, from
  people-search websites, or from online-tree suggestions that copy them.
- **These are fine:** family relationships (parents, brothers and sisters,
  partners, children); marriages in public records; a public role, such as
  a published author or an elected official; schools attended, from
  yearbooks or public notices.
- **Past homes: the town only.** A census or a directory may give a living
  person's street address. Even a directory ten years old may still give
  their home, so leave the address out.
- **Ask before publishing anything sensitive** about a living person or
  their close family, even when a record is public: adoption, divorce,
  illness, cause of death, a court case.
- **Take extra care with children.** A name and a birth year are enough.
  Publish a child's details only with a parent's agreement.
- **Ask close family about someone who died recently** before you publish
  anything sensitive about them.
- **If you are unsure whether a detail is too personal**, leave it out or
  ask the person.
- **Check the law where you publish.** Privacy law differs by country. In
  the UK and the EU, data-protection law covers details of living people.
  Check what it asks of you before you publish.

### What Flyleaf does

- **The book prints the tree as it is.** Its register names every ancestor,
  their partners, and the descendants the tree records for them, with
  whatever facts the tree holds. Flyleaf cannot leave a person or a fact out
  of the book. So keep in the tree only what you would print.
- **A static site is public**, so its build stops and lists everyone who
  may be living. You can add a death record if they have died, or set
  `site.publish_living_people` to publish them anyway. Marking someone
  `1 RESN privacy` leaves them off the site only when the book does not
  name them. The site carries the book, and the book names every ancestor,
  their partners and their recorded descendants. For anyone the book
  names, a private mark cannot hide them: the build stops instead. To keep
  such a person off the public web, use a private site. See
  [hosting.md](hosting.md#a-static-site).
- **A private site shows everything in its scope to every invited
  relative.** A `RESN` mark changes only what a static site shows.
- **The website leaves out address, phone, email and fax lines** from the
  tree. Keep them out of the tree anyway: you may share the tree with other
  programs, and the book prints what the tree holds.
- **The questionnaire hides other living people's facts and notes**, as
  described above.
- **Photographs:** when a static site leaves a person out, it drops the
  link between a photograph and that person. It does not remove the
  photograph or change its caption. Check pictures and captions of living
  people yourself. Phone photographs can also carry the place they were
  taken; see [photos-and-documents.md](photos-and-documents.md).
- **Keep the family's repository private.** `flyleaf.json` lists every
  invited relative's email address, and the tree and the archive hold
  living people.

## Relatives on a private website

On a private site with `features.submissions: true`, signed-in relatives
can send you memories, files and suggested corrections, and tie each one
to a person or a source. The correction form asks how they know: a
certificate, a family Bible or their own memory. What they send is saved
for you to review. Marking it reviewed means only that you have read it. Adding it to
the family history is a separate step that you take by hand. See
[hosting.md](hosting.md#what-relatives-can-send) for the limits.

Treat each submission like any other family source:

- Cite it like an email: who sent it, and the date.
- Record whether the sender saw it, holds a record of it, or heard it.
- Ask before you publish a photograph someone sends, and record where the
  original is.
- Reply, so the relative knows it arrived and what you did with it.

## After an edition

- **Share an early, modest edition.** Relatives who read a draft remember
  more, correct mistakes and bring out photographs. Plan a first family
  edition, collect the reactions, and revise (Stratton and Hoff, chs. 9, 11
  and 14).
- **Thank every contributor by name** in the acknowledgements, unless they
  prefer not to be named (Stratton and Hoff, ch. 7).
- **Give each contributor a copy.**
- **Before any edition goes to the family**, run the checks in
  [review.md](review.md), including a last look at every living person's
  entry.
