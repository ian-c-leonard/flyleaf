# Roadmap

What may come next, roughly in order. Nothing here has a date. Flyleaf is
kept up by one person in spare time (see [CONTRIBUTING.md](CONTRIBUTING.md)),
and fixes to bugs, privacy and other families' trees come before all of it.
To help with any item, open an issue first.

## Next: 0.2

**More families.** Trees exported from Ancestry, FamilySearch, RootsMagic
and MyHeritage, made anonymous, as a test set that CI runs on every change.

**Easier setup.**

- One installer or a ready-made container, so a newcomer installs one thing.
- Windows support.
- A guided setup for a private site, which creates the Cloudflare and Clerk
  pieces instead of leaving them to the docs.

**The book, closer to the NEHGS *Guide to Genealogical Writing*.** The
[style guide](docs/style-guide.md) marks where Flyleaf stops short today:

- places as well as dates in children's lines, and more detail for children
  who are not ancestors;
- italics in source titles, and a separate form for the bibliography;
- an index that files names as the *Guide* does, with years to tell apart
  people of the same name;
- pages before the contents: half title, copyright and dedication;
- margins you can set;
- a five-underscore blank for a partly unknown name.

**Smaller fixes.**

- The check on years in stories reads shared note records, as many exported
  trees use.
- When Flyleaf sorts a source by its title, an online tree's web address
  outranks a record's name in the title, so a tree titled "1880 census" is
  not taken for the census.
- `flyleaf coverage --mark` accepts a story, not only each person in it.
- The relatives' questionnaire leaves out research notes that no relative
  could answer, and asks before it replaces a file you have edited.

**A smaller core.** Split the largest files, and make the parts built for
one family's demanding workflow (reader links, re-anchoring, checksum
chains for sources) optional, so a newcomer meets a simpler tool.

## Later

- Books in other languages, and other countries' naming and dating customs.
- Print: tested with a print-on-demand service, with covers and print-ready
  files.
- A full screen-reader audit of the website, and speed on very large trees.
- A second maintainer.
