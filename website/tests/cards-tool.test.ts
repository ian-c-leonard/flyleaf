import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CODE_CHARACTERS,
  assignBlank,
  cardLabel,
  cardPerson,
  cardsPage,
  cardsToPrint,
  database,
  groupCards,
  keptOutOfGit,
  makeCards,
  newCode,
  readList,
  removeCardAccounts,
  statusLines,
} from '../email/cards.mjs';
import {
  blankCardNumber,
  blankCardPerson,
  cardCodeHash,
  cardCodeShape,
} from '../shared/card-code.mjs';

const DAY = 86_400_000;

void test('a new code is six letters and digits that cannot be mistaken for one another', () => {
  // No 0 or O, no 1, I or L, no 2 or Z, no 5 or S, no 8 or B, and no vowels.
  assert.match(CODE_CHARACTERS, /^[A-Z0-9]+$/);
  assert.doesNotMatch(CODE_CHARACTERS, /[01258AEIOUYLSZB]/);
  assert.equal(new Set(CODE_CHARACTERS).size, CODE_CHARACTERS.length);
  // Codes with at least one letter and one digit: all, less the all-letter
  // and all-digit ones.
  const letters = CODE_CHARACTERS.replace(/\d/g, '').length;
  const digits = CODE_CHARACTERS.length - letters;
  assert.ok(CODE_CHARACTERS.length ** 6 - letters ** 6 - digits ** 6 > 50_000_000);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const code = newCode();
    assert.match(code, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/, code);
    assert.ok(/[A-Z]/.test(code) && /\d/.test(code), code);
    for (const character of code.replace('-', ''))
      assert.ok(CODE_CHARACTERS.includes(character), code);
    assert.equal(cardCodeShape(code), true, code);
    seen.add(code);
  }
  assert.ok(seen.size > 1990, 'codes do not repeat');
  // A draw with no digit in it is drawn again.
  const at = (text: string) => text.split('').map((c) => CODE_CHARACTERS.indexOf(c));
  const draws = [...at('CCCCCC'), ...at('K7M4QX')];
  assert.equal(newCode(() => draws.shift()!), 'K7M-4QX');
  assert.equal(draws.length, 0);
});

void test('the list of people names each once, with both names and a real person', () => {
  const people = new Set(['tamsin-penhallow', 'jory-penhallow']);
  const good = [{ person: 'tamsin-penhallow', firstName: 'Tamsin', lastName: 'Penhallow' }];
  assert.deepEqual(readList(JSON.stringify(good), people), good);
  assert.deepEqual(readList(JSON.stringify(good)), good);
  for (const [bad, said] of [
    ['{', /not valid JSON/],
    ['{}', /must be a list/],
    ['[{"person":"tamsin-penhallow","firstName":"Tamsin"}]', /entry 1: "lastName" is missing/],
    ['[{"person":"tamsin-penhallow","firstName":" ","lastName":"P"}]', /"firstName" is missing/],
    ['[null]', /"person" is missing/],
    [JSON.stringify([...good, ...good]), /entry 2: tamsin-penhallow is on the list twice/],
    ['[{"person":"tamsin","firstName":"Tamsin","lastName":"Penhallow"}]', /nobody in the family tree has the id "tamsin"/],
  ] as const)
    assert.throws(() => readList(bad, people), said, bad);
});

void test('making cards stores a hash for each new code and leaves made cards alone', async () => {
  const list: { person: string; firstName: string; lastName: string; code?: string; made?: string }[] = [
    { person: 'tamsin-penhallow', firstName: ' Tamsin ', lastName: 'Penhallow' },
    { person: 'jory-penhallow', firstName: 'Jory', lastName: 'Penhallow', code: 'R9T-6WD', made: '2026-01-02' },
    { person: 'kerra-penhallow', firstName: 'Kerra', lastName: 'Penhallow' },
  ];
  const asked: { sql: string; params: unknown[] }[] = [];
  const codes = ['K7M-4QX', 'H3N-7PG'];
  let saves = 0;
  const now = Date.UTC(2026, 10, 14);
  const made = await makeCards(list, {
    query: async (sql: string, params: unknown[]) => {
      asked.push({ sql, params });
      return [];
    },
    now,
    days: 90,
    code: () => codes.shift()!,
    saved: () => {
      // Each code is in the list by the time it is saved.
      saves++;
      assert.equal(list.filter((entry) => entry.code).length, saves + 1);
    },
  });
  assert.deepEqual(made.map((entry) => entry.person), ['tamsin-penhallow', 'kerra-penhallow']);
  assert.equal(saves, 2);
  assert.equal(list[0].code, 'K7M-4QX');
  assert.equal(list[0].made, '2026-11-14');
  assert.equal(list[1].code, 'R9T-6WD');
  assert.equal(list[1].made, '2026-01-02');
  assert.equal(asked.length, 2);
  assert.match(asked[0].sql, /^INSERT INTO cards /);
  assert.deepEqual(asked[0].params, [
    await cardCodeHash('K7M-4QX'),
    'tamsin-penhallow',
    'Tamsin',
    'Penhallow',
    now,
    now + 90 * DAY,
  ]);
  // The site is never sent a code.
  assert.doesNotMatch(JSON.stringify(asked), /K7M|4QX|H3N|7PG/);
});

void test('the database is asked through Cloudflare, and refusals are explained', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let answer: { status: number; body: unknown } = {
    status: 200,
    body: { success: true, result: [{ results: [{ person: 'tamsin-penhallow' }] }] },
  };
  const query = database({
    accountId: 'account',
    databaseId: 'db',
    token: 'secret-token',
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }) as typeof fetch,
  });
  assert.deepEqual(await query('SELECT person FROM cards WHERE person = ?1', ['tamsin-penhallow']), [
    { person: 'tamsin-penhallow' },
  ]);
  assert.equal(requests[0].url, 'https://api.cloudflare.com/client/v4/accounts/account/d1/database/db/query');
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer secret-token');
  assert.deepEqual(JSON.parse(requests[0].init.body as string), {
    sql: 'SELECT person FROM cards WHERE person = ?1',
    params: ['tamsin-penhallow'],
  });
  answer = { status: 400, body: { success: false, errors: [{ message: 'no such table: cards: SQLITE_ERROR' }] } };
  await assert.rejects(query('SELECT 1'), /Set auth\.cards to true in flyleaf\.json, publish the site/);
  answer = { status: 403, body: { success: false, errors: [{ message: 'Authentication error' }] } };
  await assert.rejects(query('SELECT 1'), (error: Error) => {
    assert.match(error.message, /refused the request: Authentication error/);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
  answer = { status: 502, body: 'gateway' };
  await assert.rejects(query('SELECT 1'), /HTTP 502/);
});

void test('the page to print holds one card for each person, four to a sheet, with every value escaped', () => {
  const template = readFileSync(new URL('../email/family-cards.html', import.meta.url), 'utf8');
  const cards = ['Tamsin', 'Jory', 'Kerra', 'Morwenna', 'A <b>& Co'].map((firstName, index) => ({
    firstName,
    code: 'K7M-4Q' + 'CDFGH'[index],
  }));
  const page = cardsPage(template, cards, {
    familyName: 'The Penhallow family',
    address: 'www.example.family',
    maintainerFirstName: 'Carol',
    maintainerEmail: 'carol@example.com',
    serifFont: 'AAAA',
    sansFont: 'BBBB',
  });
  assert.equal(page.split('<article class="card">').length - 1, 5);
  assert.equal(page.split('<section class="sheet">').length - 1, 2);
  for (const card of cards.slice(0, 4)) {
    assert.ok(page.includes(`<p class="for">For ${card.firstName}</p>`), card.firstName);
    assert.ok(page.includes(`<span class="code">${card.code}</span>`), card.code);
  }
  assert.ok(page.includes('For A &lt;b&gt;&amp; Co'));
  assert.equal(page.split('Go to <span class="address">www.example.family</span>').length - 1, 5);
  assert.equal(page.split('Questions? Ask Carol: carol@example.com').length - 1, 5);
  assert.ok(page.includes('<title>Family cards · The Penhallow family</title>'));
  assert.ok(page.includes('base64,AAAA') && page.includes('base64,BBBB'));
  assert.doesNotMatch(page, /\{\{|<!-- \/?card -->/);
  // The page loads nothing from anywhere: it is opened from a folder.
  assert.doesNotMatch(page, /(src|href)="(?!data:)[^"]+"/);
  assert.throws(() => cardsPage('<p>{{code}}</p>', cards, {}), /needs <!-- card -->/);
});

void test('a household shares one printed card, with each member’s own code', () => {
  const template = readFileSync(new URL('../email/family-cards.html', import.meta.url), 'utf8');
  const entry = (firstName: string, code: string, more = {}) => ({ person: firstName.toLowerCase(), firstName, lastName: 'Penhallow', code, ...more });
  const list = [
    entry('Tamsin', 'K7M-4QX', { cardName: 'Tamsin Penhallow' }),
    entry('Jory', 'R9T-6WD', { household: 'Jory, Kerra and the children' }),
    entry('Morwenna', 'W6C-3FD'),
    entry('Kerra', 'H3N-7PG', { household: ' Jory, Kerra and the children ' }),
    entry('Daveth <b>', 'C4D-9FG', { household: 'Jory, Kerra and the children' }),
  ];
  const cards = groupCards(list);
  // One card each for Tamsin and Morwenna; the household's stands where Jory does.
  assert.deepEqual(cards.map((card) => [card.name, card.people.map((person) => person.firstName)]), [
    ['Tamsin Penhallow', ['Tamsin']],
    ['Jory, Kerra and the children', ['Jory', 'Kerra', 'Daveth <b>']],
    ['Morwenna', ['Morwenna']],
  ]);
  const values = { familyName: 'The Penhallow family', address: 'www.example.family', maintainerFirstName: 'Carol', maintainerEmail: 'carol@example.com', serifFont: 'AAAA', sansFont: 'BBBB' };
  const page = cardsPage(template, cards, values);
  assert.equal(page.split('<article class="card">').length - 1, 2);
  assert.equal(page.split('<article class="card household">').length - 1, 1);
  assert.ok(page.includes('<p class="for">For Tamsin Penhallow</p>'));
  assert.ok(page.includes('<p class="for">For Jory, Kerra and the children</p>'));
  for (const [name, code] of [['Jory', 'R9T-6WD'], ['Kerra', 'H3N-7PG'], ['Daveth &lt;b&gt;', 'C4D-9FG']])
    assert.ok(page.includes(`<span>${name}</span><span class="code">${code}</span>`), name);
  assert.doesNotMatch(page, /\{\{|<!-- \/?(card|household|person) -->/);
  // A family's own template without a household card prints each member's own.
  const plain = cardsPage('<i><!-- card --><b>{{firstName}}={{code}}</b><!-- /card --></i>', cards, {});
  assert.equal(
    plain,
    '<i><section class="sheet"><b>Tamsin Penhallow=K7M-4QX</b><b>Jory=R9T-6WD</b><b>Kerra=H3N-7PG</b><b>Daveth &lt;b&gt;=C4D-9FG</b></section>\n<section class="sheet"><b>Morwenna=W6C-3FD</b></section></i>',
  );
  assert.throws(
    () => cardsPage('<!-- card -->{{code}}<!-- /card --><!-- household -->{{name}}<!-- /household -->', cards, {}),
    /household card needs <!-- person -->/,
  );
  // The list says so when a household or a printed name is not text.
  for (const bad of [{ household: '' }, { household: 4 }, { cardName: ' ' }])
    assert.throws(
      () => readList(JSON.stringify([{ person: 'tamsin', firstName: 'Tamsin', lastName: 'Penhallow', ...bad }])),
      /must be text, or left out/,
    );
});

void test('the status of each card is one plain line', () => {
  const now = Date.UTC(2026, 10, 14);
  const row = { person: 'tamsin-penhallow', first_name: 'Tamsin', last_name: 'Penhallow', email: null, confirmed_at: null, expires_at: now + 30 * DAY };
  assert.deepEqual(
    statusLines(
      [
        row,
        { ...row, email: 'tamsin@example.com' },
        { ...row, email: 'tamsin@example.com', confirmed_at: now - DAY, expires_at: now - 1 },
        { ...row, expires_at: now - DAY },
      ],
      now,
    ),
    [
      'Tamsin Penhallow (tamsin-penhallow): not used yet; the card works until 2026-12-14',
      'Tamsin Penhallow (tamsin-penhallow): chose tamsin@example.com, has not signed in with it yet',
      'Tamsin Penhallow (tamsin-penhallow): signed in as tamsin@example.com on 2026-11-13',
      'Tamsin Penhallow (tamsin-penhallow): not used; the card stopped working on 2026-11-13',
    ],
  );
});

void test('the files that hold codes must be ones git leaves alone, before they exist', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'family-cards-git-'));
  try {
    const list = path.join(folder, 'email/cards.local.json');
    // The page's folder is made only when the page is first written.
    const page = path.join(folder, 'email/out/cards.html');
    // No repository: nothing can add either file.
    assert.equal(keptOutOfGit(list), true);
    assert.equal(keptOutOfGit(page), true);
    execFileSync('git', ['init', '-q', folder]);
    assert.equal(keptOutOfGit(list), false);
    assert.equal(keptOutOfGit(page), false);
    writeFileSync(path.join(folder, '.gitignore'), 'email/cards.local.json\n');
    assert.equal(keptOutOfGit(list), true);
    assert.equal(keptOutOfGit(page), false, 'ignoring the list does not cover the page');
    mkdirSync(path.join(folder, 'email'));
    assert.equal(keptOutOfGit(page), false);
    writeFileSync(path.join(folder, '.gitignore'), 'email/cards.local.json\nemail/out/\n');
    assert.equal(keptOutOfGit(page), true);
    mkdirSync(path.join(folder, 'email/out'));
    assert.equal(keptOutOfGit(page), true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

void test('the page leaves off a used card and one that no longer works', () => {
  const now = Date.UTC(2026, 10, 14);
  const entry = (person: string, code?: string) => ({ person, firstName: person, lastName: 'Penhallow', code });
  const list = [entry('tamsin', 'K7M-4QX'), entry('jory', 'R9T-6WD'), entry('kerra', 'H3N-7PG'), entry('morwenna', 'W6C-3FD'), entry('nobody')];
  const row = (person: string, confirmed_at: number | null, expires_at: number) => ({ person, confirmed_at, expires_at });
  const { print, used, expired } = cardsToPrint(
    list,
    [
      row('tamsin', null, now + DAY),
      row('jory', now - DAY, now - 1),
      row('kerra', null, now - 1),
      // An old card ran out; the new one works.
      row('morwenna', null, now - 1),
      row('morwenna', null, now + DAY),
    ],
    now,
  );
  assert.deepEqual(print.map((card) => card.person), ['tamsin', 'morwenna']);
  assert.deepEqual(used.map((card) => card.person), ['jory']);
  assert.deepEqual(expired.map((card) => card.person), ['kerra']);
});

void test('cancelling a card removes only the account the site made for it', async () => {
  const accounts: Record<string, { id: string; private_metadata?: { flyleaf_card?: boolean } }[]> = {
    'tamsin@example.com': [{ id: 'user_1', private_metadata: { flyleaf_card: true } }],
    'own@example.com': [{ id: 'user_2' }],
    'shared@example.com': [{ id: 'user_3', private_metadata: { flyleaf_card: true } }],
    'invited@example.com': [{ id: 'user_4', private_metadata: { flyleaf_card: true } }],
    'gone@example.com': [],
  };
  const asked: string[] = [];
  const removed = await removeCardAccounts(
    ['tamsin@example.com', 'own@example.com', 'shared@example.com', 'invited@example.com', 'gone@example.com', 'tamsin@example.com'],
    {
      // Another card still names the shared address.
      query: async (_sql: string, [email]: string[]) => (email === 'shared@example.com' ? [{ named: 1 }] : []),
      invited: ['Invited@Example.com '],
      clerk: async (method: string, where: string) => {
        asked.push(method + ' ' + where);
        return method === 'GET' ? accounts[decodeURIComponent(where.split('email_address=')[1])] : {};
      },
    },
  );
  assert.deepEqual(removed, ['tamsin@example.com']);
  assert.deepEqual(asked, [
    'GET users?limit=10&email_address=tamsin%40example.com',
    'DELETE users/user_1',
    'GET users?limit=10&email_address=own%40example.com',
    'GET users?limit=10&email_address=gone%40example.com',
  ]);
});

void test('a blank card is a numbered entry with no name, made and printed like any other', async () => {
  // The stand-in person for a blank card cannot be mistaken for a person.
  assert.equal(blankCardPerson(3), 'blank:3');
  assert.equal(blankCardNumber('blank:3'), 3);
  for (const other of ['', 'blank', 'blank:0', 'blank:03', 'blank:3x', 'tamsin-penhallow', 'blank-3', null])
    assert.equal(blankCardNumber(other), 0, String(other));
  const people = new Set(['tamsin-penhallow', 'jory-penhallow']);
  const good = [
    { person: 'tamsin-penhallow', firstName: 'Tamsin', lastName: 'Penhallow' },
    { blank: 1 },
    { blank: 3 },
    // Named since, for someone who is not in the tree, and for someone who is.
    { blank: 4, firstName: 'Morwenna', lastName: 'Rowe' },
    { blank: 5, firstName: 'Jory', lastName: 'Penhallow', person: 'jory-penhallow' },
  ];
  assert.deepEqual(readList(JSON.stringify(good), people), good);
  for (const [bad, said] of [
    [[{ blank: 0 }], /"blank" is the number printed on a blank card/],
    [[{ blank: '2' }], /"blank" is the number printed on a blank card/],
    [[{ blank: 1.5 }], /"blank" is the number printed on a blank card/],
    [[{ blank: 2 }, { blank: 2 }], /entry 2: blank card 2 is on the list twice/],
    [[{ blank: 2, household: 'The Rowes' }], /a blank card cannot share a household card/],
    [[{ blank: 2, firstName: 'Morwenna' }], /"lastName" is missing/],
    [[{ blank: 2, person: 'jory-penhallow' }], /"firstName" is missing/],
    [[{ blank: 2, firstName: 'A', lastName: 'B', person: 'nobody' }], /nobody in the family tree has the id "nobody"/],
    [[{ blank: 2, firstName: 'A', lastName: 'B', person: 'tamsin-penhallow' }, good[0]], /tamsin-penhallow is on the list twice/],
    [[{ person: 'blank:2', firstName: 'A', lastName: 'B' }], /"blank:2" cannot be a person's id/],
  ] as const)
    assert.throws(() => readList(JSON.stringify(bad), people), said, JSON.stringify(bad));
  assert.deepEqual(good.map(cardPerson), ['tamsin-penhallow', 'blank:1', 'blank:3', 'blank:4', 'jory-penhallow']);
  assert.deepEqual(good.map(cardLabel), ['Tamsin', 'blank card 1', 'blank card 3', 'Morwenna', 'Jory']);

  // The site is told a blank card's stand-in person and no name.
  const list: { blank: number; code?: string }[] = [{ blank: 3 }];
  const asked: unknown[][] = [];
  const now = Date.UTC(2026, 10, 14);
  await makeCards(list, {
    query: async (_sql: string, params: unknown[]) => {
      asked.push(params);
      return [];
    },
    now,
    days: 30,
    code: () => 'T4N-6QW',
  });
  assert.deepEqual(asked, [[await cardCodeHash('T4N-6QW'), 'blank:3', '', '', now, now + 30 * DAY]]);
  assert.equal(list[0].code, 'T4N-6QW');

  // The page: the blank block, with the card's number and no name.
  const template = readFileSync(new URL('../email/family-cards.html', import.meta.url), 'utf8');
  const values = { familyName: 'The Penhallow family', address: 'www.example.family', maintainerFirstName: 'Carol', maintainerEmail: 'carol@example.com', serifFont: 'AAAA', sansFont: 'BBBB' };
  const cards = groupCards([
    { firstName: 'Tamsin', code: 'K7M-4QX' },
    { blank: 3, code: 'T4N-6QW' },
    { blank: 4, firstName: 'Morwenna', lastName: 'Rowe', code: 'H3N-7PG' },
  ]);
  assert.deepEqual(cards.map((card: { name: string; blank?: number }) => [card.name, card.blank]), [
    ['Tamsin', undefined],
    ['', 3],
    ['Morwenna', undefined],
  ]);
  const page = cardsPage(template, cards, values);
  assert.equal(page.split('<article class="card">').length - 1, 2);
  assert.equal(page.split('<article class="card blank">').length - 1, 1);
  assert.ok(page.includes('<p class="for">For <span class="write"></span></p>'));
  assert.ok(page.includes('<span class="number">No. 3</span>'));
  assert.ok(page.includes('<span class="code">T4N-6QW</span>'));
  assert.ok(page.includes('<p class="for">For Morwenna</p>'));
  assert.doesNotMatch(page, /\{\{|<!-- \/?(card|household|person|blank) -->/);
  // With no blank cards, the blank block leaves nothing behind.
  assert.doesNotMatch(cardsPage(template, cards.slice(0, 1), values), /class="card blank"|No\. |<!-- \/?blank -->/);
  // A family's own template without a blank block prints the card with no name.
  assert.equal(
    cardsPage('<i><!-- card --><b>{{firstName}}={{code}}</b><!-- /card --></i>', cards, {}),
    '<i><section class="sheet"><b>Tamsin=K7M-4QX</b><b>=T4N-6QW</b><b>Morwenna=H3N-7PG</b></section></i>',
  );
  assert.equal(
    cardsPage('<!-- card -->{{firstName}}<!-- /card --><!-- blank -->[{{number}}:{{code}}]<!-- /blank -->', cards, {}),
    '<section class="sheet">Tamsin[3:T4N-6QW]Morwenna</section>',
  );

  // Status and printing know a blank card by its number.
  const row = { person: 'blank:3', first_name: '', last_name: '', email: null, confirmed_at: null, expires_at: now + 30 * DAY };
  assert.deepEqual(
    statusLines(
      [
        row,
        { ...row, email: 'guest@example.com', confirmed_at: now - DAY },
        { ...row, person: 'blank:4', first_name: 'Morwenna', last_name: 'Rowe' },
      ],
      now,
    ),
    [
      'Blank card 3: not used yet; the card works until 2026-12-14',
      'Blank card 3: signed in as guest@example.com on 2026-11-13',
      'Morwenna Rowe (blank card 4): not used yet; the card works until 2026-12-14',
    ],
  );
  const { print, used } = cardsToPrint(
    [
      { blank: 3, code: 'T4N-6QW' },
      { blank: 4, code: 'H3N-7PG' },
      { blank: 6 },
    ],
    [
      { person: 'blank:3', confirmed_at: now - DAY, expires_at: now + DAY },
      { person: 'blank:4', confirmed_at: null, expires_at: now + DAY },
    ],
    now,
  );
  assert.deepEqual(print.map((card) => card.blank), [4]);
  assert.deepEqual(used.map((card) => card.blank), [3]);
});

void test('saying who has a blank card names them on the site and in their account', async () => {
  type Entry = { blank?: number; person?: string; firstName?: string; lastName?: string; code?: string };
  const list: Entry[] = [
    { person: 'tamsin-penhallow', firstName: 'Tamsin', lastName: 'Penhallow', code: 'K7M-4QX' },
    { blank: 3, code: 'T4N-6QW' },
    { blank: 4 },
  ];
  const asked: { sql: string; params: unknown[] }[] = [];
  const calls: string[] = [];
  let rows: { email: string | null }[] = [{ email: 'guest@example.com' }];
  const options = {
    query: async (sql: string, params: unknown[]) => {
      asked.push({ sql, params });
      return rows;
    },
    clerk: async (method: string, where: string, body?: unknown) => {
      calls.push(method + ' ' + where + (body ? ' ' + JSON.stringify(body) : ''));
      return method === 'GET'
        ? [{ id: 'user_1', private_metadata: { flyleaf_card: true } }, { id: 'user_2' }]
        : {};
    },
  };
  // In the tree: the site shows them their own relatives.
  assert.deepEqual(
    await assignBlank(list, 3, { firstName: ' Jory ', lastName: 'Penhallow', person: 'jory-penhallow' }, options),
    { email: 'guest@example.com', renamed: true },
  );
  assert.match(asked[0].sql, /^UPDATE cards SET person = \?1, first_name = \?2, last_name = \?3 WHERE person = \?4 RETURNING email$/);
  assert.deepEqual(asked[0].params, ['jory-penhallow', 'Jory', 'Penhallow', 'blank:3']);
  assert.deepEqual(list[1], { blank: 3, code: 'T4N-6QW', firstName: 'Jory', lastName: 'Penhallow', person: 'jory-penhallow' });
  // Only the account the site made for the card is renamed.
  assert.deepEqual(calls, [
    'GET users?limit=10&email_address=guest%40example.com',
    'PATCH users/user_1 {"first_name":"Jory","last_name":"Penhallow"}',
  ]);
  // Said again, for someone who is not in the tree: the card finds its row by
  // the person it had, and goes back to its stand-in.
  rows = [{ email: null }];
  assert.deepEqual(
    await assignBlank(list, 3, { firstName: 'Morwenna', lastName: 'Rowe' }, options),
    { email: '', renamed: false },
  );
  assert.deepEqual(asked[1].params, ['blank:3', 'Morwenna', 'Rowe', 'jory-penhallow']);
  assert.deepEqual(list[1], { blank: 3, code: 'T4N-6QW', firstName: 'Morwenna', lastName: 'Rowe' });
  assert.equal(calls.length, 2);
  // What cannot be done is said plainly, and nothing is asked of the site.
  const before = asked.length;
  await assert.rejects(assignBlank(list, 9, { firstName: 'A', lastName: 'B' }, options), /There is no blank card 9 on the list/);
  await assert.rejects(assignBlank(list, 4, { firstName: 'A', lastName: 'B' }, options), /Blank card 4 has not been made yet/);
  await assert.rejects(assignBlank(list, 3, { firstName: 'A', lastName: ' ' }, options), /Give both names/);
  await assert.rejects(
    assignBlank(list, 3, { firstName: 'Tamsin', lastName: 'Penhallow', person: 'tamsin-penhallow' }, options),
    /tamsin-penhallow already has a card on the list/,
  );
  assert.equal(asked.length, before);
  // A card the site no longer has.
  rows = [];
  await assert.rejects(assignBlank(list, 3, { firstName: 'A', lastName: 'B' }, options), /The site has no card for blank card 3/);
  assert.equal(list[1].firstName, 'Morwenna');
});
