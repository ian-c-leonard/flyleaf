import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clerkFixture } from './helpers/clerk-fixture.mjs';
import { applySubmissionSchema } from './helpers/submission-schema.mjs';
import { cardCodeHash } from '../shared/card-code.mjs';

const origin = 'https://example.family';
const policy = JSON.parse(await readFile('shared/card-policy.json', 'utf8'));
const DAY = 86_400_000;

// A local stand-in for the sign-in service's accounts.
function accounts() {
  const users = new Map();
  const made = [];
  const removed = [];
  let next = 1;
  let refuse = null;
  return {
    users,
    made,
    removed,
    emails: () =>
      [...users.values()]
        .map((user) => user.email)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    refuseWith: (value) => {
      refuse = value;
    },
    // An account that exists already, made some other way.
    add: (email, signedIn = null) => {
      const id = 'user_' + next++;
      users.set(id, { id, email, last_sign_in_at: signedIn });
      return id;
    },
    api: async (request, url) => {
      assert.equal(
        request.headers.get('Authorization'),
        'Bearer sk_live_isolated_local_fixture_not_a_real_credential',
      );
      if (url.pathname === '/v1/users' && request.method === 'GET') {
        const email = url.searchParams.get('email_address');
        return Response.json(
          [...users.values()].filter((user) => user.email === email),
        );
      }
      if (url.pathname === '/v1/users' && request.method === 'POST') {
        const body = await request.json();
        if (refuse) return Response.json(refuse.body, { status: refuse.status });
        made.push(body);
        const id = 'user_' + next++;
        users.set(id, {
          id,
          email: body.email_address[0],
          last_sign_in_at: null,
          private_metadata: body.private_metadata,
        });
        return Response.json({ id });
      }
      const one = /^\/v1\/users\/(user_\d+)$/.exec(url.pathname);
      if (one && request.method === 'DELETE') {
        removed.push(users.get(one[1])?.email);
        users.delete(one[1]);
        return Response.json({ id: one[1], deleted: true });
      }
      return null;
    },
  };
}

async function site(t, overrides = {}, { schema = true } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'family-cards-'));
  await writeFile(join(temporary, 'index.html'), 'PRIVATE FAMILY');
  const clerk = accounts();
  const f = await clerkFixture(
    temporary,
    { CARDS_OPEN: 'true', ADMIN_EMAILS: 'ada@example.org', ...overrides },
    { api: clerk.api },
  );
  const db = await f.mf.getD1Database('SUBMISSIONS_DB');
  if (schema) await applySubmissionSchema(db);
  t.after(async () => {
    await f.dispose();
    await rm(temporary, { recursive: true, force: true });
  });
  let address = 1;
  const card = async (code, person, first, last, changes = {}) => {
    const row = {
      created_at: Date.now(),
      expires_at: Date.now() + 30 * DAY,
      email: null,
      confirmed_at: null,
      ...changes,
    };
    await db
      .prepare(
        'INSERT INTO cards (code_hash, person, first_name, last_name, created_at, expires_at, email, confirmed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      )
      .bind(await cardCodeHash(code), person, first, last, row.created_at, row.expires_at, row.email, row.confirmed_at)
      .run();
  };
  // Each call comes from its own address unless a test names one.
  const post = (step, body, { headers = {}, from } = {}) =>
    f.req('/api/card/' + step, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': from || '198.51.100.' + address++,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const as = async (email) => ({ Cookie: f.cookie(await f.token({ email, sub: 'user_' + email })) });
  const session = async (email) =>
    f.req('/api/session', { headers: await as(email) });
  const row = (code) =>
    cardCodeHash(code).then((hash) =>
      db.prepare('SELECT * FROM cards WHERE code_hash = ?1').bind(hash).first(),
    );
  // The day's count, and the highest count any one address has.
  const counts = async () => {
    const found = {};
    for (const r of (await db.prepare('SELECT bucket, count FROM card_attempts').all()).results) {
      const kind = r.bucket.replace(/:[a-f0-9]{32}:\d+$/, ':address').replace(/:day:\d+$/, ':day');
      found[kind] = Math.max(found[kind] ?? 0, r.count);
    }
    return found;
  };
  // Choose an email and sign in with it: the whole of a card's use.
  const use = async (code, email) => {
    assert.equal((await post('email', { code, email })).status, 200);
    assert.equal((await post('confirm', { code }, { headers: await as(email) })).status, 200);
  };
  return { f, db, clerk, card, post, as, session, row, counts, use };
}

void test('a card code greets its holder by name, however it is typed', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  for (const typed of ['K7M-4QX', 'k7m 4qx', ' K7m.4qx ', 'k7m4qx']) {
    const r = await s.post('check', { code: typed });
    assert.equal(r.status, 200, typed);
    assert.deepEqual(await r.json(), { firstName: 'Tamsin' });
    assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  }
  for (const typed of ['K7M-4QW', '4QX-K7M', 'K7M', '', 'x'.repeat(500)]) {
    const r = await s.post('check', { code: typed });
    assert.equal(r.status, 404, typed);
    assert.deepEqual(await r.json(), { error: 'no-match' });
  }
  // The sign-in page learns that cards are on.
  assert.equal((await (await s.f.req('/login/config.json')).json()).cards, true);
});

void test('card requests come only from the family site, as small JSON posts', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const good = { code: 'K7M-4QX' };
  assert.equal((await s.post('check', good, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.f.req('/api/card/check', { method: 'POST', body: JSON.stringify(good) })).status, 403);
  assert.equal((await s.post('check', good, { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal((await s.post('check', '{"code":')).status, 400);
  assert.equal((await s.post('check', '["K7M-4QX"]')).status, 400);
  assert.equal((await s.post('check', { code: 4827 })).status, 400);
  assert.equal((await s.post('check', { code: 'K7M-4QX', pad: 'x'.repeat(3000) })).status, 400);
  for (const step of ['unknown', 'check/x', 'CHECK', 'confirm/'])
    assert.equal((await s.post(step, good, { headers: await s.as('tamsin@example.com') })).status, 404, step);
  for (const method of ['PUT', 'DELETE', 'PATCH'])
    assert.equal(
      (await s.f.req('/api/card/check', { method, headers: { Origin: origin } })).status,
      405,
      method,
    );
  // Reading is not a card step: a visitor who is not signed in is sent away.
  assert.equal((await s.f.req('/api/card/check')).status, 401);
  assert.equal((await s.post('confirm', good)).status, 401);
  // A request that is not a card request is never counted as a wrong code.
  assert.deepEqual(await s.counts(), {});
});

void test('with cards off, no card step exists, and those who used a card stay let in', async (t) => {
  const s = await site(t, { CARDS_OPEN: 'false' });
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  await s.card('R9T-6WD', 'jory-penhallow', 'Jory', 'Penhallow', {
    email: 'jory@example.com',
    confirmed_at: Date.now() - DAY,
  });
  for (const step of ['check', 'email'])
    assert.equal((await s.post(step, { code: 'K7M-4QX', email: 'tamsin@example.com' })).status, 404);
  assert.equal(
    (await s.post('confirm', { code: 'K7M-4QX' }, { headers: await s.as('tamsin@example.com') })).status,
    404,
  );
  assert.equal((await (await s.f.req('/login/config.json')).json()).cards, false);
  assert.equal(s.clerk.made.length, 0);
  // Jory used his card while cards were on.
  const session = await s.session('jory@example.com');
  assert.equal(session.status, 200);
  assert.equal((await session.json()).person, 'jory-penhallow');
  assert.equal((await s.session('tamsin@example.com')).status, 403);
  assert.deepEqual((await (await s.session('ada@example.org')).json()).viewers, [
    'jory-penhallow',
    'tamsin-penhallow',
  ]);
});

void test('a site that never had cards refuses a stranger plainly; with cards on, a missing table is an error', async (t) => {
  const never = await site(t, { CARDS_OPEN: 'false' }, { schema: false });
  assert.equal((await never.session('stranger@example.com')).status, 403);
  assert.deepEqual(await (await never.session('ada@example.org')).json(), {
    allowed: true,
    person: '',
    admin: true,
    viewers: [],
  });
  const broken = await site(t, {}, { schema: false });
  assert.equal((await broken.session('stranger@example.com')).status, 503);
  assert.equal((await broken.post('check', { code: 'K7M-4QX' })).status, 503);
});

void test('choosing an email makes the account, and only signing in with it opens the site', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const code = 'k7m 4qx';

  for (const email of ['', 'tamsin', 'tamsin@', '@example.com', 'tam sin@example.com', 'tamsin@example', 'a@b.c', 'x'.repeat(250) + '@example.com']) {
    const r = await s.post('email', { code, email });
    assert.equal(r.status, 400, email);
    assert.deepEqual(await r.json(), { error: 'email' });
  }
  assert.equal(s.clerk.made.length, 0);
  assert.equal((await s.row(code)).email_changes, 0);

  const chosen = await s.post('email', { code, email: '  Tamsin@Example.com ' });
  assert.equal(chosen.status, 200);
  assert.deepEqual(await chosen.json(), { email: 'tamsin@example.com' });
  assert.deepEqual(s.clerk.made, [
    {
      email_address: ['tamsin@example.com'],
      first_name: 'Tamsin',
      last_name: 'Penhallow',
      skip_password_requirement: true,
      private_metadata: { flyleaf_card: true },
    },
  ]);

  // Chosen, not yet proven: the address opens nothing.
  assert.equal((await s.session('tamsin@example.com')).status, 403);
  // Someone signed in with another address cannot confirm this card.
  const other = await s.post('confirm', { code }, { headers: await s.as('mallory@example.com') });
  assert.equal(other.status, 403);
  assert.deepEqual(await other.json(), { error: 'other-email' });
  assert.equal((await s.session('mallory@example.com')).status, 403);
  // An unverified email cannot confirm it either.
  const unverified = await s.f.token({ email: 'tamsin@example.com', email_verified: false });
  assert.equal(
    (await s.post('confirm', { code }, { headers: { Cookie: s.f.cookie(unverified) } })).status,
    401,
  );
  // Nor can the right address with a wrong code.
  assert.equal(
    (await s.post('confirm', { code: 'K7M-4QW' }, { headers: await s.as('tamsin@example.com') })).status,
    404,
  );
  assert.equal((await s.session('tamsin@example.com')).status, 403);

  const confirmed = await s.post('confirm', { code }, { headers: await s.as('tamsin@example.com') });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await confirmed.json(), { allowed: true });
  const session = await s.session('tamsin@example.com');
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { allowed: true, person: 'tamsin-penhallow', admin: false });
  const home = await s.f.req('/', { headers: { ...(await s.as('tamsin@example.com')), Accept: 'text/html' } });
  assert.equal(home.status, 200);
  assert.equal(await home.text(), 'PRIVATE FAMILY');
  // Confirming twice changes nothing.
  assert.equal(
    (await s.post('confirm', { code }, { headers: await s.as('tamsin@example.com') })).status,
    200,
  );

  // The card is now used: it tells its holder which address to sign in with
  // and never takes another.
  const again = await s.post('check', { code });
  assert.deepEqual(await again.json(), { used: true, hint: 't…@example.com' });
  const second = await s.post('email', { code, email: 'mallory@example.com' });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: 'used', hint: 't…@example.com' });
  assert.equal((await s.row(code)).email, 'tamsin@example.com');
  assert.equal(s.clerk.made.length, 1);
});

void test('a mistyped email can be changed before it is used, and its account is removed', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const code = 'K7M-4QX';
  assert.equal((await s.post('email', { code, email: 'tamsni@example.com' })).status, 200);
  assert.equal((await s.post('email', { code, email: 'tamsin@example.com' })).status, 200);
  assert.deepEqual(s.clerk.removed, ['tamsni@example.com']);
  assert.deepEqual(s.clerk.emails(), ['tamsin@example.com']);
  // Choosing the same address again makes no second account and is no change.
  assert.equal((await s.post('email', { code, email: 'tamsin@example.com' })).status, 200);
  assert.equal(s.clerk.made.length, 2);
  assert.equal((await s.row(code)).email_changes, 2);
  // The mistyped address never opens the site, whoever signs in with it.
  assert.equal(
    (await s.post('confirm', { code }, { headers: await s.as('tamsni@example.com') })).status,
    403,
  );
  assert.equal((await s.session('tamsni@example.com')).status, 403);
});

void test('only an unused account the site made for a card is ever removed', async (t) => {
  const s = await site(t, { ALLOWED_EMAILS: 'ada@example.org,kerra@example.com' });
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  await s.card('R9T-6WD', 'jory-penhallow', 'Jory', 'Penhallow');
  const [tamsin, jory] = ['K7M-4QX', 'R9T-6WD'];
  const choose = async (code, email) =>
    assert.equal((await s.post('email', { code, email })).status, 200, email);

  // An account that existed before is used as it is, and left alone after.
  s.clerk.add('shared@example.com');
  await choose(tamsin, 'shared@example.com');
  assert.equal(s.clerk.made.length, 0);
  await choose(tamsin, 'typo@example.com');
  assert.deepEqual(s.clerk.removed, []);

  // Two cards name the same mistyped address. It stays while either does,
  // and goes when the second card moves on, whichever card made it.
  await choose(jory, 'typo@example.com');
  await choose(tamsin, 'tamsin@example.com');
  assert.deepEqual(s.clerk.removed, []);
  await choose(jory, 'jory@example.com');
  assert.deepEqual(s.clerk.removed, ['typo@example.com']);

  // An account someone has signed in with is never removed.
  for (const user of s.clerk.users.values())
    if (user.email === 'jory@example.com') user.last_sign_in_at = 1790000000000;
  await choose(jory, 'jory2@example.com');
  // Nor is one at an address flyleaf.json invites: that relative has no
  // other way to get an account on an invitation-only site.
  await choose(tamsin, 'kerra@example.com');
  await choose(tamsin, 'tamsin2@example.com');
  assert.deepEqual(s.clerk.removed, ['typo@example.com', 'tamsin@example.com']);
  assert.deepEqual(s.clerk.emails(), [
    'jory2@example.com',
    'jory@example.com',
    'kerra@example.com',
    'shared@example.com',
    'tamsin2@example.com',
  ]);
});

void test('a card may try a few email addresses, not an endless list', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const code = 'K7M-4QX';
  // A refusal by the sign-in service does not use up a try.
  s.clerk.refuseWith({ status: 500, body: {} });
  assert.equal((await s.post('email', { code, email: 'first@example.com' })).status, 503);
  assert.equal((await s.row(code)).email_changes, 0);
  s.clerk.refuseWith(null);
  for (let i = 1; i <= policy.emailChanges; i++)
    assert.equal((await s.post('email', { code, email: `try${i}@example.com` })).status, 200, String(i));
  const stopped = await s.post('email', { code, email: 'onemore@example.com' });
  assert.equal(stopped.status, 429);
  assert.deepEqual(await stopped.json(), { error: 'too-many-emails' });
  // The last address still works, and can still be confirmed.
  assert.equal((await s.post('email', { code, email: `try${policy.emailChanges}@example.com` })).status, 200);
  assert.deepEqual(s.clerk.emails(), [`try${policy.emailChanges}@example.com`]);
  assert.equal(
    (await s.post('confirm', { code }, { headers: await s.as(`try${policy.emailChanges}@example.com`) })).status,
    200,
  );
});

void test('addresses chosen for one card at the same moment leave one account, the card’s', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const code = 'K7M-4QX';
  const answers = await Promise.all(
    ['one', 'two', 'three', 'four'].map((name) => s.post('email', { code, email: name + '@example.com' })),
  );
  for (const answer of answers) assert.ok([200, 409].includes(answer.status), String(answer.status));
  assert.ok(answers.some((answer) => answer.status === 200));
  const card = await s.row(code);
  assert.deepEqual(s.clerk.emails(), [card.email]);
});

void test('two cards may share one email; the first to confirm names the reader', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  await s.card('R9T-6WD', 'jory-penhallow', 'Jory', 'Penhallow');
  for (const code of ['R9T-6WD', 'K7M-4QX']) await s.use(code, 'home@example.com');
  assert.equal(s.clerk.made.length, 1);
  assert.equal((await (await s.session('home@example.com')).json()).person, 'jory-penhallow');
});

void test('an email in flyleaf.json keeps its own person, and the maintainer can view as each card holder', async (t) => {
  const s = await site(t, {
    ALLOWED_EMAILS: 'ada@example.org,kerra@example.com,morwenna@example.com',
    VIEWER_PEOPLE: 'kerra@example.com=kerra-penhallow',
  });
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  await s.card('R9T-6WD', 'jory-penhallow', 'Jory', 'Penhallow', { expires_at: Date.now() - 1 });
  await s.card('H3N-7PG', 'morwenna-penhallow', 'Morwenna', 'Penhallow');
  await s.use('K7M-4QX', 'kerra@example.com');
  assert.deepEqual(await (await s.session('kerra@example.com')).json(), {
    allowed: true,
    person: 'kerra-penhallow',
    admin: false,
  });
  // An invited email with no person of its own takes the card's.
  assert.equal((await (await s.session('morwenna@example.com')).json()).person, '');
  await s.use('H3N-7PG', 'morwenna@example.com');
  assert.equal((await (await s.session('morwenna@example.com')).json()).person, 'morwenna-penhallow');
  // The expired, unused card is not offered as a view.
  assert.deepEqual(await (await s.session('ada@example.org')).json(), {
    allowed: true,
    person: '',
    admin: true,
    viewers: ['kerra-penhallow', 'morwenna-penhallow', 'tamsin-penhallow'],
  });
});

void test('an unused card stops working after its last day; a used one keeps its sign-in until it is cancelled', async (t) => {
  const s = await site(t);
  await s.card('R9T-6WD', 'jory-penhallow', 'Jory', 'Penhallow', { expires_at: Date.now() - 1 });
  assert.equal((await s.post('check', { code: 'R9T-6WD' })).status, 404);
  assert.equal((await s.post('email', { code: 'R9T-6WD', email: 'jory@example.com' })).status, 404);
  assert.equal(s.clerk.made.length, 0);

  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  await s.card('H3N-7PG', 'kerra-penhallow', 'Kerra', 'Penhallow');
  await s.use('K7M-4QX', 'tamsin@example.com');
  await s.use('H3N-7PG', 'kerra@example.com');
  // A used card keeps working as a sign-in after its last day.
  await s.db.prepare('UPDATE cards SET expires_at = 1').run();
  assert.equal((await s.session('tamsin@example.com')).status, 200);
  assert.deepEqual(await (await s.post('check', { code: 'K7M-4QX' })).json(), {
    used: true,
    hint: 't…@example.com',
  });
  // Cancelled: a reader the site has not seen this minute is refused at once.
  // One it has just seen is remembered for up to a minute (docs/hosting.md).
  await s.db.prepare('DELETE FROM cards').run();
  assert.equal((await s.session('kerra@example.com')).status, 403);
  assert.equal((await s.session('tamsin@example.com')).status, 200);
});

void test('wrong codes from one address are limited, and nothing is stored about the guesser but a count', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const from = '203.0.113.7';
  // Right codes use up nothing, however many.
  for (let i = 0; i < policy.wrongPerAddressHour + 5; i++)
    assert.equal((await s.post('check', { code: 'K7M-4QX' }, { from })).status, 200);
  assert.deepEqual(await s.counts(), { 'wrong:address': 0, 'wrong:day': 0 });
  for (let i = 0; i < policy.wrongPerAddressHour; i++)
    assert.equal((await s.post('check', { code: 'GUESS-' + (1000 + i) }, { from })).status, 404);
  // The right code no longer helps this address...
  const stopped = await s.post('check', { code: 'K7M-4QX' }, { from });
  assert.equal(stopped.status, 429);
  assert.deepEqual(await stopped.json(), { error: 'too-many', wait: 'hour' });
  assert.equal((await s.post('email', { code: 'K7M-4QX', email: 'tamsin@example.com' }, { from })).status, 429);
  assert.equal(s.clerk.made.length, 0);
  // ...while another home is not held up.
  assert.equal((await s.post('check', { code: 'K7M-4QX' })).status, 200);

  // An address past its limit writes nothing more, and takes nothing more
  // from the count every home shares.
  for (let i = 0; i < 50; i++)
    assert.equal((await s.post('check', { code: 'GUESS-' + (3000 + i) }, { from })).status, 429);
  assert.deepEqual(await s.counts(), {
    'wrong:address': policy.wrongPerAddressHour,
    'wrong:day': policy.wrongPerAddressHour,
  });
  const stored = (await s.db.prepare('SELECT bucket FROM card_attempts').all()).results.map((r) => r.bucket).join('\n');
  assert.doesNotMatch(stored, /203\.0\.113|GUESS|K7M/i);
});

void test('wrong codes sent all at once cannot pass the limit together', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const from = '203.0.113.9';
  const answers = await Promise.all(
    Array.from({ length: 150 }, (_, i) => s.post('check', { code: 'GUESS-' + (1000 + i) }, { from })),
  );
  const looked = answers.filter((answer) => answer.status === 404).length;
  assert.equal(looked, policy.wrongPerAddressHour);
  assert.equal(answers.filter((answer) => answer.status === 429).length, 150 - looked);
  // The count everyone shares rose by no more than this address's own limit.
  assert.equal((await s.counts())['wrong:day'], policy.wrongPerAddressHour);
  assert.equal((await s.post('check', { code: 'K7M-4QX' })).status, 200);
});

void test('one home’s IPv6 addresses count as one, however they are written', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const wrong = (from, i) => s.post('check', { code: 'GUESS-' + (1000 + i) }, { from });
  // Thirty addresses in 2001:db8:0:0::/64, written short and long.
  for (let i = 0; i < policy.wrongPerAddressHour; i++)
    assert.equal(
      (await wrong(i % 2 ? `2001:db8::${(i + 1).toString(16)}:1` : `2001:0DB8:0000:0000:${i + 1}:0:0:1`, i)).status,
      404,
    );
  for (const from of ['2001:db8::ffff:1', '2001:db8:0:0:9::', '2001:db8::'])
    assert.equal((await s.post('check', { code: 'K7M-4QX' }, { from })).status, 429, from);
  // The next network along is another home.
  for (const from of ['2001:db8:0:1::9', '2001:db8:0:1:ffff::', '::1', '::ffff:203.0.113.7'])
    assert.equal((await s.post('check', { code: 'K7M-4QX' }, { from })).status, 200, from);
});

void test('wrong codes from many addresses stop every card for the day, and old counts are cleared', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const day = Math.floor(Date.now() / DAY);
  await s.db.prepare("INSERT INTO card_attempts (bucket, count, expires_at) VALUES ('wrong:day:1', 5, 1)").run();
  await s.db
    .prepare('INSERT INTO card_attempts (bucket, count, expires_at) VALUES (?1, ?2, ?3)')
    .bind('wrong:day:' + day, policy.wrongPerDay - 1, (day + 1) * DAY)
    .run();
  // The last wrong code of the day, and the clearing of a count long over.
  assert.equal((await s.post('check', { code: 'GUESS-1000' })).status, 404);
  assert.equal(await s.db.prepare("SELECT count(*) AS n FROM card_attempts WHERE bucket = 'wrong:day:1'").first('n'), 0);
  const closed = await s.post('check', { code: 'K7M-4QX' });
  assert.equal(closed.status, 429);
  assert.deepEqual(await closed.json(), { error: 'too-many', wait: 'day' });
  // A signed-in relative already let in is not affected.
  await s.card('R9T-6WD', 'jory-penhallow', 'Jory', 'Penhallow', { email: 'jory@example.com', confirmed_at: Date.now() });
  assert.equal((await s.session('jory@example.com')).status, 200);
});

void test('when the sign-in service refuses, the card is left as it was', async (t) => {
  const s = await site(t);
  await s.card('K7M-4QX', 'tamsin-penhallow', 'Tamsin', 'Penhallow');
  const code = 'K7M-4QX';
  s.clerk.refuseWith({
    status: 422,
    body: { errors: [{ code: 'form_param_format_invalid', meta: { param_name: 'email_address' } }] },
  });
  const invalid = await s.post('email', { code, email: 'tamsin@example.com' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'email' });
  s.clerk.refuseWith({
    status: 422,
    body: { errors: [{ code: 'form_password_required', meta: { param_name: 'password' } }] },
  });
  const unavailable = await s.post('email', { code, email: 'tamsin@example.com' });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'unavailable' });
  assert.equal((await s.row(code)).email, null);
  assert.equal((await s.row(code)).email_changes, 0);
  // An account that appeared a moment earlier is not an error.
  s.clerk.refuseWith({ status: 422, body: { errors: [{ code: 'form_identifier_exists' }] } });
  assert.equal((await s.post('email', { code, email: 'tamsin@example.com' })).status, 200);
  assert.equal((await s.row(code)).email, 'tamsin@example.com');
});
