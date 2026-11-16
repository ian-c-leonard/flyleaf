// Family cards: a printed card with a short code, for a relative whose email
// address you do not have. The relative goes to the site, types the code, is
// welcomed by name, and chooses the email address they will sign in with.
//
//   node website/email/cards.mjs                    make a card for each person
//                                                   on the list who has none,
//                                                   and write the page to print
//   node website/email/cards.mjs --status           who has used their card
//   node website/email/cards.mjs --cancel <person>  cancel a person's card, the
//                                                   sign-in it gave them, and
//                                                   the account made for it
//                                                   (a blank card: its number)
//   node website/email/cards.mjs --assign 3 --first Tamsin --last Penhallow
//                                [--person tamsin-penhallow]
//                                                   say who has blank card 3
//   node website/email/cards.mjs --days 90          how long a new card may
//                                                   wait to be used (365)
//
// Run it from Flyleaf's folder with the family named, as for every other
// script: FLYLEAF_FAMILY=../my-family node website/email/cards.mjs
//
// Cards need auth.cards: true in flyleaf.json and the site published once
// after that (docs/hosting.md). The list lives in the family's email folder
// (paths.email in flyleaf.json, default email/), in cards.local.json:
//   [{ "person": "tamsin-penhallow", "firstName": "Tamsin", "lastName": "Penhallow" }]
// `person` is the person's id in the family tree. An entry may also have:
//   "cardName":  the name printed on the card, when the first name is not
//                enough, such as "Tamsin Penhallow"
//   "household": people with the same household share one printed card, which
//                is headed with this text, such as "Tamsin, Jory and the
//                children". Each still has a code and a sign-in of their own.
// A blank card is for someone you have not chosen yet. Its entry is only
// { "blank": 3 }, where 3 is the number printed small on the card. You write
// the name on the card by hand. Its holder is let in and welcomed without a
// name. When you know who has it, --assign records their name, and the
// person they are in the family tree if they are in it.
// The script adds each code to this file, and writes the page to print to
// out/cards.html. A code opens
// the site, so both files must stay out of git; the script checks.
// The site's database holds only a hash of each code.
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardsOn,
  FamilyError,
  familyRoot,
  readSettings,
} from '../flyleaf-settings.mjs';
import { isMain } from '../scripts/is-main.mjs';
import {
  blankCardNumber,
  blankCardPerson,
  cardCodeHash,
} from '../shared/card-code.mjs';
import policy from '../shared/card-policy.json' with { type: 'json' };
import { fill } from './invite.mjs';

const DAY = 86_400_000;

// The letters and digits of a code. None can be mistaken for another when
// read from a card: no 0 or O, no 1, I or L, no 2 or Z, no 5 or S, no 8 or B.
// There are no vowels, so a code never spells a word.
export const CODE_CHARACTERS = 'CDFGHJKMNPQRTVWX34679';

/** A new code: six letters and digits in two groups, such as K7M-4QX. Every
 * code has at least one letter and one digit. */
export function newCode(pick = randomInt) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++)
      code += CODE_CHARACTERS[pick(CODE_CHARACTERS.length)];
    if (/[A-Z]/.test(code) && /\d/.test(code))
      return code.slice(0, 3) + '-' + code.slice(3);
  }
}

/** The list of people who get a card, checked. `people` is every person id
 * in the family tree, or null when the tree file is not there to check.
 * @param {string} text
 * @param {Set<string> | null} [people] */
export function readList(text, people = null) {
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    throw new FamilyError('cards.local.json is not valid JSON.');
  }
  if (!Array.isArray(list))
    throw new FamilyError('cards.local.json must be a list: [{ ... }, { ... }]');
  const seen = new Set();
  const numbers = new Set();
  const isText = (value) => typeof value === 'string' && !!value.trim();
  for (const [index, entry] of list.entries()) {
    const where = `cards.local.json, entry ${index + 1}`;
    const blank = entry?.blank;
    if (blank !== undefined) {
      if (!Number.isInteger(blank) || blank < 1 || blank > 9999)
        throw new FamilyError(
          `${where}: "blank" is the number printed on a blank card: a whole number from 1.`,
        );
      if (numbers.has(blank))
        throw new FamilyError(`${where}: blank card ${blank} is on the list twice.`);
      numbers.add(blank);
      if (entry.household !== undefined)
        throw new FamilyError(`${where}: a blank card cannot share a household card.`);
      // Named later, with --assign: both names, and the person if in the tree.
      const named = ['person', 'firstName', 'lastName'].some((key) => entry[key] !== undefined);
      for (const key of named ? ['firstName', 'lastName'] : [])
        if (!isText(entry[key])) throw new FamilyError(`${where}: "${key}" is missing.`);
      if (entry.person !== undefined && !isText(entry.person))
        throw new FamilyError(`${where}: "person" must be text, or left out.`);
    } else {
      for (const key of ['person', 'firstName', 'lastName'])
        if (!isText(entry?.[key])) throw new FamilyError(`${where}: "${key}" is missing.`);
    }
    if (entry.person !== undefined) {
      if (blankCardNumber(entry.person))
        throw new FamilyError(`${where}: "${entry.person}" cannot be a person's id.`);
      if (seen.has(entry.person))
        throw new FamilyError(`${where}: ${entry.person} is on the list twice.`);
      seen.add(entry.person);
      if (people && !people.has(entry.person))
        throw new FamilyError(
          `${where}: nobody in the family tree has the id "${entry.person}".`,
        );
    }
    for (const key of ['cardName', 'household'])
      if (entry[key] !== undefined && !isText(entry[key]))
        throw new FamilyError(`${where}: "${key}" must be text, or left out.`);
  }
  return list;
}

/** Who the site's database says an entry's card is for: the person, or the
 * stand-in for a blank card nobody in the tree has been given. */
export const cardPerson = (entry) => entry.person || blankCardPerson(entry.blank);

/** What to call an entry's card in a message. */
export const cardLabel = (entry) =>
  entry.firstName ||
  (entry.blank !== undefined ? `blank card ${entry.blank}` : entry.person);

/** The printed cards for the people on the list: one for each person, and
 * one for each household, placed where its first member stands. A card is
 * `{ name, people }`, and each of its people has a firstName and a code. A
 * blank card nobody has been named for is `{ name: '', blank, people }`. */
export function groupCards(entries) {
  const cards = [];
  const households = new Map();
  for (const entry of entries) {
    const label = entry.household?.trim();
    if (entry.blank !== undefined && !entry.firstName) {
      cards.push({ name: '', blank: entry.blank, people: [entry] });
    } else if (!label) {
      cards.push({ name: entry.cardName?.trim() || entry.firstName, people: [entry] });
    } else if (households.has(label)) {
      households.get(label).people.push(entry);
    } else {
      const card = { name: label, people: [entry] };
      households.set(label, card);
      cards.push(card);
    }
  }
  return cards;
}

/** The page to print. The template's card block prints once for each card
 * with one person. A card for a household uses the household block, with its
 * person block once for each member; a template without one prints each
 * member's own card instead. A blank card uses the blank block, which has
 * {{number}} and room to write a name; a template without one prints the
 * card block with no name. Every value is escaped for HTML. */
export function cardsPage(template, cards, values) {
  const household = /<!-- household -->([\s\S]*)<!-- \/household -->/.exec(template);
  const blank = /<!-- blank -->([\s\S]*)<!-- \/blank -->/.exec(template);
  let rest = template;
  for (const block of [household, blank]) if (block) rest = rest.replace(block[0], '');
  const parts = /^([\s\S]*)<!-- card -->([\s\S]*)<!-- \/card -->([\s\S]*)$/.exec(rest);
  if (!parts)
    throw new FamilyError(
      'family-cards.html needs <!-- card --> and <!-- /card --> around one card.',
    );
  const [, head, block, tail] = parts;
  const member = household && /^([\s\S]*)<!-- person -->([\s\S]*)<!-- \/person -->([\s\S]*)$/.exec(household[1]);
  if (household && !member)
    throw new FamilyError(
      'In family-cards.html, the household card needs <!-- person --> and <!-- /person --> around one name and code.',
    );
  const one = (name, person) =>
    fill(block, { ...values, firstName: name, code: person.code }, { html: true });
  const printed = [];
  for (const card of cards) {
    // A plain list entry is a card for one person.
    const people = card.people || [card];
    const name = card.name || card.cardName || card.firstName;
    if (card.blank !== undefined)
      printed.push(
        blank
          ? fill(blank[1], { ...values, number: card.blank, code: people[0].code }, { html: true })
          : one('', people[0]),
      );
    else if (people.length === 1) printed.push(one(name, people[0]));
    else if (!member)
      for (const person of people) printed.push(one(person.cardName || person.firstName, person));
    else
      printed.push(
        fill(member[1], { ...values, name }, { html: true }) +
          people
            .map((person) =>
              fill(member[2], { ...values, firstName: person.firstName, code: person.code }, { html: true }),
            )
            .join('') +
          fill(member[3], { ...values, name }, { html: true }),
      );
  }
  const sheets = [];
  for (let i = 0; i < printed.length; i += 4)
    sheets.push('<section class="sheet">' + printed.slice(i, i + 4).join('') + '</section>');
  return (
    fill(head, values, { html: true }) +
    sheets.join('\n') +
    fill(tail, values, { html: true })
  );
}

/** Ask the site's database a question, over Cloudflare's API. */
export function database({ accountId, databaseId, token, fetch = globalThis.fetch }) {
  return async function query(sql, params = []) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params: params.map(String) }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const said =
        body?.errors?.map((problem) => problem.message).join('; ') ||
        `HTTP ${response.status}`;
      if (/no such table: cards/.test(said))
        throw new FamilyError(
          'The site has no place for cards yet. Set auth.cards to true in ' +
            'flyleaf.json, publish the site (flyleaf deploy), then run this again.',
        );
      throw new FamilyError('The site database refused the request: ' + said);
    }
    return body.result[0].results;
  };
}

/** Give every person on the list without a code a new card. Returns the
 * people who got one. The database gets a hash of each code, never the code.
 * `saved` runs after each card, so a code the site knows is written down
 * before the next one is made. */
export async function makeCards(
  list,
  { query, now = Date.now(), days = policy.validDays, code = newCode, saved = () => {} },
) {
  const made = [];
  for (const entry of list) {
    if (entry.code) continue;
    const fresh = code();
    await query(
      'INSERT INTO cards (code_hash, person, first_name, last_name, created_at, expires_at) ' +
        // Cloudflare's API sends every value as text; the two times are numbers.
        'VALUES (?1, ?2, ?3, ?4, CAST(?5 AS INTEGER), CAST(?6 AS INTEGER))',
      [
        await cardCodeHash(fresh),
        cardPerson(entry),
        // A blank card has no name until --assign gives it one.
        (entry.firstName || '').trim(),
        (entry.lastName || '').trim(),
        now,
        now + days * DAY,
      ],
    );
    entry.code = fresh;
    entry.made = new Date(now).toISOString().slice(0, 10);
    made.push(entry);
    saved();
  }
  return made;
}

/** One line for each card the site knows, in plain words. */
export function statusLines(rows, now = Date.now()) {
  const date = (time) => new Date(Number(time)).toISOString().slice(0, 10);
  return rows.map((row) => {
    const number = blankCardNumber(row.person);
    const name = `${row.first_name} ${row.last_name}`.trim();
    const who = !number
      ? `${name} (${row.person})`
      : name
        ? `${name} (blank card ${number})`
        : `Blank card ${number}`;
    if (row.confirmed_at) return `${who}: signed in as ${row.email} on ${date(row.confirmed_at)}`;
    if (Number(row.expires_at) <= now) return `${who}: not used; the card stopped working on ${date(row.expires_at)}`;
    if (row.email) return `${who}: chose ${row.email}, has not signed in with it yet`;
    return `${who}: not used yet; the card works until ${date(row.expires_at)}`;
  });
}

/** The cards to print, and those left off the page: a used card, and an
 * unused one past its last day, which no longer works. `rows` is what the
 * site knows of each card.
 * @template {{ person?: string, blank?: number, code?: string }} Entry
 * @param {Entry[]} list
 * @param {{ person: string, confirmed_at: unknown, expires_at: unknown }[]} rows
 * @param {number} [now] */
export function cardsToPrint(list, rows, now = Date.now()) {
  const state = new Map();
  for (const row of rows) {
    const used = !!row.confirmed_at;
    const before = state.get(row.person);
    // A person with an old card and a new one is judged by the one in use,
    // else by the one that still works.
    if (!before || used || (!before.used && Number(row.expires_at) > now))
      state.set(row.person, { used, expired: !used && Number(row.expires_at) <= now });
  }
  const held = list.filter((entry) => entry.code);
  return {
    print: held.filter((entry) => {
      const card = state.get(cardPerson(entry));
      return !card || (!card.used && !card.expired);
    }),
    used: held.filter((entry) => state.get(cardPerson(entry))?.used),
    expired: held.filter((entry) => state.get(cardPerson(entry))?.expired),
  };
}

/** After a card is cancelled: remove the account the site made for each of
 * its addresses, unless another card names the address or flyleaf.json
 * invites it. `clerk(method, path)` asks the sign-in service. Returns the
 * addresses whose account was removed.
 * @param {string[]} emails
 * @param {{ query: Function, invited?: string[], clerk: Function }} options */
export async function removeCardAccounts(emails, { query, invited = [], clerk }) {
  /** @type {string[]} */
  const removed = [];
  const kept = new Set(invited.map((email) => email.trim().toLowerCase()));
  for (const email of new Set(emails)) {
    if (kept.has(email)) continue;
    const named = await query('SELECT 1 AS named FROM cards WHERE email = ?1 LIMIT 1', [email]);
    if (named.length) continue;
    const found = await clerk('GET', 'users?limit=10&email_address=' + encodeURIComponent(email));
    for (const account of found)
      if (account.private_metadata?.flyleaf_card === true) {
        await clerk('DELETE', 'users/' + encodeURIComponent(account.id));
        removed.push(email);
      }
  }
  return removed;
}

/** Record who has a blank card: their name, and the person they are in the
 * family tree when they are in it. The site then welcomes them by name and
 * shows them their own relatives. The account the site made for them, if
 * they have signed in, gets the name too. Returns the card's email address,
 * if one was chosen, and whether its account was renamed.
 * @param {{ blank?: number, person?: string, firstName?: string, lastName?: string, code?: string }[]} list
 * @param {number} number
 * @param {{ firstName: string, lastName: string, person?: string }} who
 * @param {{ query: Function, clerk: Function }} options */
export async function assignBlank(list, number, who, { query, clerk }) {
  const entry = list.find((item) => item.blank === number);
  if (!entry) throw new FamilyError(`There is no blank card ${number} on the list.`);
  if (!entry.code)
    throw new FamilyError(
      `Blank card ${number} has not been made yet. Run the script without options first.`,
    );
  const firstName = who.firstName.trim();
  const lastName = who.lastName.trim();
  if (!firstName || !lastName)
    throw new FamilyError('Give both names: --first <name> --last <name>');
  if (who.person && list.some((item) => item !== entry && item.person === who.person))
    throw new FamilyError(`${who.person} already has a card on the list.`);
  const rows = await query(
    'UPDATE cards SET person = ?1, first_name = ?2, last_name = ?3 ' +
      'WHERE person = ?4 RETURNING email',
    [who.person || blankCardPerson(number), firstName, lastName, cardPerson(entry)],
  );
  if (!rows.length)
    throw new FamilyError(`The site has no card for blank card ${number}. Was it cancelled?`);
  entry.firstName = firstName;
  entry.lastName = lastName;
  if (who.person) entry.person = who.person;
  else delete entry.person;
  const emails = rows.map((row) => row.email).filter(Boolean);
  let renamed = false;
  for (const email of emails) {
    const found = await clerk('GET', 'users?limit=10&email_address=' + encodeURIComponent(email));
    for (const account of found)
      if (account.private_metadata?.flyleaf_card === true) {
        await clerk('PATCH', 'users/' + encodeURIComponent(account.id), {
          first_name: firstName,
          last_name: lastName,
        });
        renamed = true;
      }
  }
  return { email: emails[0] || '', renamed };
}

/** True unless a file is, or would be, inside a git repository that does not
 * ignore it. The file and its folder need not exist yet. */
export function keptOutOfGit(file) {
  let folder = path.dirname(path.resolve(file));
  while (!existsSync(folder) && path.dirname(folder) !== folder)
    folder = path.dirname(folder);
  try {
    execFileSync('git', ['check-ignore', '-q', path.resolve(file)], {
      cwd: folder,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    // 1: git would add the file. 128: no repository here. No status: no git.
    return error.status !== 1;
  }
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1] || '';
  };
  const settings = readSettings();
  const engine = fileURLToPath(new URL('.', import.meta.url));
  const here = path.resolve(familyRoot(), settings.paths?.email || 'email');
  const listFile = path.join(here, 'cards.local.json');
  const pageFile = path.join(here, 'out', 'cards.html');
  console.log(`Family: ${settings.family.name} (${familyRoot()})`);
  const credentials = settings.deploy.credentials_dir.replace(/^~(?=\/)/, homedir());
  const token = readFileSync(path.join(credentials, 'cloudflare.env'), 'utf8')
    .match(/^(?:export\s+)?CLOUDFLARE_API_TOKEN=(.*)$/m)?.[1]
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!token)
    throw new FamilyError('cloudflare.env has no CLOUDFLARE_API_TOKEN.');
  // The sign-in service, asked with the family's own key.
  const clerk = async (method, where, body) => {
    const key = readFileSync(path.join(credentials, 'clerk.env'), 'utf8')
      .match(/^(?:export\s+)?CLERK_SECRET_KEY=(.*)$/m)?.[1]
      .trim()
      .replace(/^['"]|['"]$/g, '');
    const response = await fetch('https://api.clerk.com/v1/' + where, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new FamilyError(`The sign-in service refused the request (HTTP ${response.status}).`);
    return response.json();
  };
  const query = database({
    accountId: settings.cloudflare.account_id,
    databaseId: settings.cloudflare.submissions_db.id,
    token,
  });
  const rows = () =>
    query(
      'SELECT person, first_name, last_name, expires_at, email, confirmed_at ' +
        'FROM cards ORDER BY last_name, first_name, created_at',
    );
  const tree = path.resolve(
    familyRoot(),
    settings.paths?.source_gedcom || 'data/family.src.ged',
  );
  const people = existsSync(tree)
    ? new Set(
        [...readFileSync(tree, 'utf8').matchAll(/^1 REFN (.+?)\s*$/gm)].map(
          (match) => match[1],
        ),
      )
    : null;
  const list = existsSync(listFile)
    ? readList(readFileSync(listFile, 'utf8'), people)
    : [];
  const save = () => writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');

  if (args.includes('--status')) {
    const lines = statusLines(await rows());
    console.log(lines.length ? lines.join('\n') : 'No cards have been made.');
  } else if (args.includes('--assign')) {
    const number = Number(option('--assign'));
    const who = {
      firstName: option('--first') || '',
      lastName: option('--last') || '',
      person: option('--person') || undefined,
    };
    if (!Number.isInteger(number) || number < 1)
      throw new FamilyError(
        'Give the number on the blank card: --assign 3 --first <name> --last <name> [--person <person id>]',
      );
    if (who.person && people && !people.has(who.person))
      throw new FamilyError(`Nobody in the family tree has the id "${who.person}".`);
    const { email, renamed } = await assignBlank(list, number, who, { query, clerk });
    save();
    console.log(
      `Blank card ${number} is ${who.firstName} ${who.lastName}'s` +
        (who.person ? ` (${who.person}).` : '. They are not linked to a person in the tree.') +
        (email
          ? ` They ${renamed ? 'signed in' : 'chose to sign in'} as ${email}.`
          : ' The card has not been used yet.') +
        '\nThe site knows them by name within a minute.',
    );
  } else if (args.includes('--cancel')) {
    const named = option('--cancel');
    if (!named)
      throw new FamilyError('Name the person, or the number on a blank card: --cancel <person id>');
    // A number names a blank card, whoever has since been named for it.
    const blank = /^\d+$/.test(named)
      ? list.find((entry) => entry.blank === Number(named))
      : undefined;
    const person = blank ? cardPerson(blank) : /^\d+$/.test(named) ? blankCardPerson(Number(named)) : named;
    const gone = await query('DELETE FROM cards WHERE person = ?1 RETURNING email', [person]);
    if (!gone.length) throw new FamilyError(`No card was made for ${named}.`);
    for (const entry of list)
      if (cardPerson(entry) === person) {
        delete entry.code;
        delete entry.made;
      }
    if (existsSync(listFile)) save();
    // The page still shows the cancelled code.
    rmSync(pageFile, { force: true });
    const emails = gone.map((row) => row.email).filter(Boolean);
    const removed = await removeCardAccounts(emails, {
      query,
      invited: settings.auth.allowed_emails || [],
      clerk,
    });
    console.log(
      `Cancelled ${blank ? 'blank card ' + named : 'the card for ' + person}.` +
        (emails.length
          ? ` ${emails.join(', ')} can no longer open the site, within a minute.`
          : ' No email address had been chosen with it.') +
        (removed.length ? ' The account the site made was removed.' : '') +
        '\nRun the script again to make them a new card and a new page to print.',
    );
  } else {
    if (!cardsOn(settings))
      throw new FamilyError(
        'Cards are off. Set auth.cards to true in flyleaf.json and publish the site first.',
      );
    if (!existsSync(listFile))
      throw new FamilyError(
        `Make the list first: ${listFile}\n` +
          '  [{ "person": "tamsin-penhallow", "firstName": "Tamsin", "lastName": "Penhallow" }]',
      );
    for (const file of [listFile, pageFile])
      if (!keptOutOfGit(file))
        throw new FamilyError(
          `${file} would be added to git, and a code opens the site. ` +
            'Add it to .gitignore first.',
        );
    const days = Number(option('--days') ?? policy.validDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new FamilyError('--days takes a whole number of days, such as 90.');
    const made = await makeCards(list, { query, days, saved: save });
    const { print: toPrint, used, expired } = cardsToPrint(list, await rows());
    const font = (name) =>
      readFileSync(path.join(engine, '../public/login/fonts', name)).toString('base64');
    const template = readFileSync(
      existsSync(path.join(here, 'family-cards.html'))
        ? path.join(here, 'family-cards.html')
        : path.join(engine, 'family-cards.html'),
      'utf8',
    );
    mkdirSync(path.dirname(pageFile), { recursive: true });
    writeFileSync(
      pageFile,
      cardsPage(template, groupCards(toPrint), {
        familyName: settings.family.name,
        address: settings.auth.card_address || settings.site.domain,
        maintainerFirstName: settings.maintainer.first_name,
        maintainerEmail: settings.maintainer.email,
        serifFont: font('eb-garamond-latin-400-normal.woff2'),
        sansFont: font('source-sans-3-latin-wght-normal.woff2'),
      }),
    );
    console.log(
      made.length
        ? `Made ${made.length} new ${made.length === 1 ? 'card' : 'cards'}: ` +
            made.map(cardLabel).join(', ') + '.'
        : 'Everyone on the list already has a card.',
    );
    const said = (entry) => cardLabel(entry).replace(/^b/, 'B');
    for (const entry of used)
      console.log(
        entry.firstName
          ? `${entry.firstName} has used their card; it is left off the page.`
          : `${said(entry)} has been used; it is left off the page.`,
      );
    for (const entry of expired)
      console.log(
        (entry.firstName ? `${entry.firstName}'s card` : said(entry)) +
          ' was not used in time and no longer works; it is left off ' +
          `the page. For a new one: --cancel ${entry.person || entry.blank}, then run this again.`,
      );
    console.log(
      `Cards to print (${groupCards(toPrint).length}): ${path.relative(process.cwd(), pageFile)}\n` +
        'Open it in a browser and print at 100%. Keep it private: each code opens the site.',
    );
  }
}
