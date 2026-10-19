# Lineage societies

A lineage society, also called a hereditary society, admits people who can
prove descent from a qualifying ancestor: someone who served in a particular
war, sailed on a particular ship, or settled a particular place early. A
documented Flyleaf tree and book already hold most of what an application
needs. This guide covers:

- what societies generally ask for;
- how to use their earlier applications as sources, and the limits of those
  applications;
- how to assemble the proof from your tree and book;
- the care to take before you claim a famous ancestor.

Each society sets its own rules, forms and fees, and changes them from time
to time. Read the society's current requirements before you start, and again
before you send anything. This guide describes what most societies have in
common.

## Some societies

| Society | Qualifying ancestor |
|---|---|
| Daughters of the American Revolution (DAR) | Someone who served or supported the cause of American independence during the Revolution. Members are women. |
| Sons of the American Revolution (SAR) | The same kinds of ancestor. Members are men. |
| General Society of Mayflower Descendants | A passenger on the *Mayflower* in 1620. |
| Society of the Cincinnati | An officer of the Continental Army or Navy in the Revolution. Admission is limited, usually to one descendant of each officer at a time, under the society's own rules of succession. |
| United Empire Loyalists' Association of Canada | A Loyalist who settled in British North America. The association grants a certificate to proven descendants. |
| Fellowship of First Fleeters (Australia) | Someone who arrived in Australia with the First Fleet in 1788. |

Many more exist, for other wars, early settlers of a colony or town,
religious refugees and other groups.

What a society offers varies: a library, a journal, meetings, grave markers
for qualifying ancestors, scholarships. Weigh that against the fees and the
paperwork. Societies for the same ancestor ask for much the same chain of
records, so one well-assembled proof can serve several applications.

## What a society asks for

Most societies ask you to prove three things.

1. **The ancestor qualifies.** The ancestor did what the society requires.
   The society decides what counts as proof: a service record, a pension
   file, a passenger list, or its own published list of qualifying
   ancestors.
2. **Every generation.** For each person in the line from you to the
   ancestor: birth or baptism, marriage, and death, with dates and places.
   Many societies ask for the same for each spouse in the line.
3. **Every link.** For each generation, a record that shows the parent-child
   relationship by naming the parent. Examples are a birth or baptism entry,
   a will that names the child, a deed between parent and child, a pension
   file, or a census that states each person's relationship to the head of
   the household. In the United States, the federal census states those
   relationships from 1880 onwards.

Most societies also expect the following.

- **Copies of the records,** with citations. Recent vital records may need to
  be certified copies, or long-form certificates that name the parents.
- **Your own generations.** Your birth record naming your parents, your
  parents' marriage, and so on up the line.
- **A record that names the relationship.** A child listed in a household
  without a stated relationship, a matching name in an index, or a gravestone
  near a parent's suggests a link. Alone, it does not prove one.
- **More than trees and traditions.** Most societies do not accept online
  family trees, compiled genealogies that cite no records, or family
  tradition on their own.
- **A written argument where no single record names a parent.** Some
  societies accept a proof built from several records that together point to
  one answer and rule out the others. This is called indirect evidence.
  Expect the society's genealogists to read it closely. See
  [research-standards.md](research-standards.md) for how to weigh the
  records in it.
- **DNA under the society's own rules.** Societies that accept DNA evidence
  usually want it alongside documents. Read their rules before you test.

The society's genealogists review each application, and may ask for more
proof. Answer a request like that with records.

## Earlier applications as sources

Many societies keep the applications they have accepted. Some publish an
index of qualifying ancestors, and sell copies of earlier applications with
their supporting documents.

### What they are good for

- **A map of the line.** An accepted application names each generation, and
  often says where its evidence was found.
- **Documents.** Older files sometimes hold copies of Bible pages, letters
  or records that are now hard to find.
- **A head start.** Many societies let a new applicant rely on an accepted
  application for the generations it shares with theirs. You then prove only
  the generations from where your line joins it. Ask the society how it
  handles this.
- **Warnings.** A society may note on an ancestor's record that an earlier
  line has a problem, or that future applicants must give more proof. Read
  those notes before anything else.

### Their limits

- **An acceptance reflects the standard of its day.** In the early years of
  many societies, applications were accepted with little or no
  documentation. Family tradition or a printed genealogy was often enough.
- **An application is compiled work.** It records someone else's
  conclusions. Cite it as compiled work. Once you have seen a record it
  contains, cite that record as a record.
- **Printed lineage books and abstracts are further from the evidence.**
  Errors creep in as they are copied, and generations can drop out.
- **Shared names cause errors.** A father and son, two cousins, or a child
  who died young and a later sibling given the same name are easily merged.
  Service has been credited to the wrong man of the same name. Check every
  identification against ages, places and family.
- **An application covers only its own line.** It says nothing about the
  link between your family and the applicant's.
- **Copies may leave out living people.** Societies usually withhold details
  of living members from the copies they sell.

### Recording them in Flyleaf

Make the application a source in your tree like any other. Put the society,
the application's number and its date in the title. Choose its kind with
`_TIER` (see [gedcom.md](gedcom.md#sources-and-citations)):

- `authoritative-secondary` for a recent application whose supporting
  records you have read and judged sound;
- `compiled-secondary` for an older application, an application without its
  records, or an entry in a printed lineage book.

Flyleaf's research standards give accepted applications as an example of
`authoritative-secondary` work. Treat that as the most an application can
be, and judge each one. The choice matters. A person marked `primary` needs
at least one `primary` or `authoritative-secondary` source, and the build
stops when such a person has only weaker sources. Do not let an old
application lift a person to `primary`.

When you have read the records attached to an application, cite each one
under the fact it supports, as its own source.

## Assembling the proof from your tree and book

Assemble the proof in this order.

### 1. Find the line

The ancestor table numbers every ancestor from the book's root person, who
is no. 1. A father is twice his child's number, and a mother is twice plus
one. To find the line from an ancestor down to the root, halve the
ancestor's number, dropping any half, until you reach 1. Each number on the
way is one generation.

In the sample family, John Penhallow is no. 16. His line to Tamsin Penhallow,
no. 1, runs 16, 8, 4, 2, 1: John; his son William Henry; William's son
Robert John; Robert's son David; and David's daughter Tamsin.

If the person applying is not the book's root, follow the line down to the
ancestor they share with the root, then add their own generations.

### 2. Make a table of the generations

Make one row for each generation, from the ancestor down to the applicant:

| No. | Person and spouse | Birth | Marriage | Death | Record naming the parent |
|---|---|---|---|---|---|
| 16 | John Penhallow and Elizabeth Ann Trembath | | | | |
| 8 | William Henry Penhallow and Edith May Rowe | | | | |

Fill it from the book. The register gives each cited birth, baptism,
marriage, death and burial a footnote, and "Sources for the Register" lists
each person's other citations. `flyleaf sources <id>` lists every citation
the tree holds for a person, with its kind.

### 3. Check each link

Flyleaf does not record which record proves a parent-child link. That is
your job. For each generation, find the record that names the parent. Cite
it where it belongs, usually under the child's birth or baptism. Put the
words that name the parent in the citation's `PAGE`, so the proof shows in
the tree and in the book. The sample tree does this for John Penhallow's
baptism:

    1 BAPM
    2 DATE 6 APR 1845
    2 PLAC St Just in Penwith, Cornwall, England
    2 SOUR @SRC_SJ_BAP1845@
    3 PAGE p. 31, entry 244: John, son of Richard Penhallow, miner, and Grace his wife, of Trewellard

A generation with no such record is a gap. Fill it before you apply, or
build a written argument from several records, as described under
[What a society asks for](#what-a-society-asks-for).

### 4. Look at each person's confidence

Each person's confidence (`_CONFLEVEL`) shows the weak points at a glance.
A person at `tree-link`, `memoir` or `unknown` rests on compiled work,
family testimony or nothing yet. In the sample tree, John Penhallow is
`primary` and his son William Henry is `tree-link`, so William's generation
needs more proof before the line could go to a society.

Confidence describes the person as a whole. A `primary` person can still
lack a record naming a parent, so do step 3 for everyone.

### 5. Get the records themselves

Societies want copies of records. Where your tree cites an index, a
transcription or a compiled work, order the original or a certified copy.
Your citations say where to look.

For generations who have died, save each copy in `images/` and attach it to
its source with `OBJE` and `FILE` (see [gedcom.md](gedcom.md#files)), so the
book and the next application can use it.

For living generations, save each copy in a research folder, such as
`images/research/lineage/`, and do not attach it in the tree. Attaching a
file publishes it on the website. A file in a research folder stays off the
website even if it is attached by mistake, unless the tree also gives it a
`_KIND` and a `_SHA256`. See step 7.

### 6. Resolve every conflict

A society's genealogist will notice when two records disagree about a date,
a place or a name. Write down how you resolved each conflict, and send it
with the application. In the sample tree, a note on John Penhallow explains
why the register gives 1868 for his arrival: the passenger list was made at
the time, his obituary agrees, and the county album that says 1867 was
compiled long afterwards. Write a note like that for every conflict in the
line.

### 7. Keep living people's records private

Your own generations need records of living people, such as your birth
certificate and your parents' marriage. Send them to the society. Keep them
out of the book and off any public website: save them in a research folder,
as in step 5, and do not attach them in the tree. See
[research-standards.md](research-standards.md#saving-your-sources) and
[hosting.md](hosting.md).

### 8. After acceptance

Add the accepted application to your tree as a source, with its number and
date, and keep a copy of everything you sent. Acceptance means the
society's genealogists judged the proof sufficient. The records underneath
are still the evidence, so cite them for the facts.

## Before you claim a famous ancestor

Famous ancestors attract false descents. Online trees copy each other. Some
printed genealogies, especially older ones, joined a family to a famous or
titled one on little more than a shared surname. Online trees now also hold
text written by machines that nobody checked. A descent from a passenger, a
patriot, a signer or a royal house needs more care than any other line in
the book.

Before you write it down or apply:

1. **Read the best published study.** Scholars have traced the descendants
   of many famous people, in peer-reviewed journals or in a society's own
   series. The General Society of Mayflower Descendants, for example,
   publishes a series tracing passengers' families through five
   generations. If your line disagrees with the best study, assume your line
   is wrong until a record shows otherwise.
2. **Check the chronology.** Work out each parent's age at marriage and at
   each child's birth. A mother of twelve or sixty, a soldier of nine, or a
   child born long after the father's death means the line is wrong.
3. **Watch for namesakes.** Many places had several men of the same name at
   once. A child who died young was often followed by a sibling given the
   same name. Check that your ancestor is the right one by age, place and
   family.
4. **Test the bridge.** The weakest link is usually the generation where
   your documented line meets the famous family, often where records are
   thin. Find the record that joins them. A shared surname and a nearby place
   are only a reason to look.
5. **Keep family tradition as tradition.** Record the story as family
   testimony, with who told it and when. Then test it against records, however
   old the story is and however often it has been told.
6. **Write at the confidence the evidence supports.** Until the line is
   proved, the book presents it as a family tradition or a possibility, with
   the evidence in the source notes (see [style-guide.md](style-guide.md)).
   `flyleaf coverage` warns about words of certainty such as "undoubtedly"
   (rule L15).

An invented example. A family story says that Thomas Ashcombe, a farmer born
about 1790, was the grandson of a colonel of the Revolution with the same
surname. An online tree agrees, but cites only other trees. The colonel's
will names five children. His only son was born in 1781, just nine years
before Thomas, so he cannot be Thomas's father. A daughter's son would
normally carry his own father's surname. The book keeps the story as family
tradition, and the source notes give the reasoning.

## Before you send an application

- You have read the society's current rules, forms and fees.
- You have read the society's notes on your ancestor.
- Every generation has its birth, marriage and death, each with a copy of
  the record.
- Every link has a record that names the parent, or a written argument.
- Every conflict has a written resolution.
- Originals or certified copies stand in place of indexes and
  transcriptions.
- The line agrees with the best published study, or you can show why it
  differs.
- Living people's records go only to the society.
