// Family cards. A printed card carries a short code. A relative types it on
// the sign-in page, is greeted by name, and chooses the email address they
// will sign in with. The site makes their account, with the name the card was
// made for. The card lets that email in only once the relative has also
// signed in with it: a mistyped address never opens the site to a stranger.
import policy from '../shared/card-policy.json' with { type: 'json' };
import {
  blankCardNumber,
  cardCodeHash,
  sha256Hex,
} from '../shared/card-code.mjs';
import { protect } from './archive.ts';
import { listed } from './site.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** New cards are taken only when the family turns them on (auth.cards in
 * flyleaf.json). A relative who has already used a card keeps their sign-in
 * when cards are turned off again. */
export const cardsOn = (env: { CARDS_OPEN?: string }) =>
  env.CARDS_OPEN === 'true';

type Card = {
  code_hash: string;
  person: string;
  first_name: string;
  last_name: string;
  expires_at: number;
  email: string | null;
  confirmed_at: number | null;
};
const CARD =
  'SELECT code_hash, person, first_name, last_name, expires_at, email, ' +
  'confirmed_at FROM cards WHERE code_hash = ?1';

class CardError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const reply = (status: number, body: Record<string, unknown>) =>
  protect(Response.json(body, { status }));

/** Enough of a used card's email to remind its holder which one they chose. */
const hint = (email: string | null) =>
  email ? email.slice(0, 1) + '…' + email.slice(email.lastIndexOf('@')) : '';

const emailShape = (email: string) =>
  email.length <= 254 &&
  /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[a-z0-9-]{2,}$/.test(email);

/** The code and email a card request carries. A request is a few hundred
 * bytes of JSON; reading stops at 2,000 bytes, whatever the request claims. */
async function readBody(request: Request) {
  if (
    !request.headers.get('Content-Type')?.startsWith('application/json') ||
    !request.body
  )
    return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(2000);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > bytes.length) {
      await reader.cancel();
      return null;
    }
    bytes.set(value, size);
    size += value.byteLength;
  }
  try {
    const body: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(0, size)),
    );
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const { code, email } = body as { code?: unknown; email?: unknown };
    if (typeof code !== 'string') return null;
    return { code, email: typeof email === 'string' ? email : '' };
  } catch {
    return null;
  }
}

/** What wrong codes are counted against: an IPv4 address, or the first four
 * groups of an IPv6 address, which one home shares. "::" stands for as many
 * zero groups as make eight. */
export function addressGroup(address: string) {
  const text = address.trim().toLowerCase().split('%')[0];
  if (!text.includes(':')) return text;
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // An IPv4 address written at the end stands for two groups.
  const width = (groups: string[]) =>
    groups.reduce((n, group) => n + (group.includes('.') ? 2 : 1), 0);
  const zeros =
    tail === undefined ? 0 : Math.max(0, 8 - width(left) - width(right));
  return [...left, ...Array<string>(zeros).fill('0'), ...right]
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}

/** Look a code up, within the limits on wrong codes. A place in both counts,
 * this address's for the hour and everyone's for the day, is taken before
 * the code is looked at, and given back when the code is right. So codes
 * sent all at once cannot pass a limit together. An address past its own
 * limit is refused on a read alone: it writes nothing, and it takes nothing
 * from the day's count that other homes share. */
async function lookUp(request: Request, env: Env, code: string, now: number) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const who = (
    await sha256Hex('flyleaf-card-address:' + addressGroup(address))
  ).slice(0, 32);
  const hour = Math.floor(now / HOUR);
  const day = Math.floor(now / DAY);
  const mine = `wrong:${who}:${hour}`;
  const everyone = `wrong:day:${day}`;
  const db = env.SUBMISSIONS_DB;
  const before = await db
    .prepare('SELECT bucket, count FROM card_attempts WHERE bucket IN (?1, ?2)')
    .bind(mine, everyone)
    .all<{ bucket: string; count: number }>();
  const soFar = (bucket: string) =>
    before.results.find((row) => row.bucket === bucket)?.count ?? 0;
  if (soFar(everyone) >= policy.wrongPerDay) return { wait: 'day' };
  if (soFar(mine) >= policy.wrongPerAddressHour) return { wait: 'hour' };
  const [held, heldToday, , found] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        'INSERT INTO card_attempts (bucket, count, expires_at) VALUES (?1, 1, ?2) ' +
          'ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count',
      )
      .bind(mine, (hour + 1) * HOUR),
    // Only an address still within its own limit takes from the day's count.
    db
      .prepare(
        'INSERT INTO card_attempts (bucket, count, expires_at) SELECT ?1, 1, ?2 ' +
          'WHERE (SELECT count FROM card_attempts WHERE bucket = ?3) <= ?4 ' +
          'ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count',
      )
      .bind(everyone, (day + 1) * DAY, mine, policy.wrongPerAddressHour),
    db.prepare('DELETE FROM card_attempts WHERE expires_at < ?1').bind(now),
    db.prepare(CARD).bind(await cardCodeHash(code)),
  ]);
  if ((held.results[0].count as number) > policy.wrongPerAddressHour)
    return { wait: 'hour' };
  if ((heldToday.results[0].count as number) > policy.wrongPerDay)
    return { wait: 'day' };
  const card = found.results[0] as Card | undefined;
  // An unused card stops working after its last day; a used one stays used.
  if (!card || (card.confirmed_at === null && card.expires_at <= now))
    return { wait: '' };
  await db
    .prepare(
      'UPDATE card_attempts SET count = count - 1 WHERE bucket IN (?1, ?2) AND count > 0',
    )
    .bind(mine, everyone)
    .run();
  return { wait: '', card };
}

function clerk(env: Env, path: string, init: RequestInit = {}) {
  return fetch('https://api.clerk.com/v1/' + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + env.CLERK_SECRET_KEY,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
}

type Account = {
  id: string;
  last_sign_in_at: number | null;
  private_metadata?: { flyleaf_card?: boolean };
};

async function accounts(env: Env, email: string) {
  const response = await clerk(
    env,
    'users?limit=10&email_address=' + encodeURIComponent(email),
  );
  if (!response.ok) throw new CardError(503, 'unavailable');
  return (await response.json()) as Account[];
}

/** Make the relative's account, with the name the card was made for. The
 * sign-in service can be set to require a name, and a blank card has none
 * yet. Its account carries the card's number until the card is named
 * (cards.mjs --assign). The family site never shows this name. The account
 * is marked as made for a card, so it can be removed if unused. */
async function createAccount(env: Env, email: string, card: Card) {
  const response = await clerk(env, 'users', {
    method: 'POST',
    body: JSON.stringify({
      email_address: [email],
      first_name: card.first_name || 'Blank card',
      last_name: card.last_name || `No. ${blankCardNumber(card.person)}`,
      skip_password_requirement: true,
      private_metadata: { flyleaf_card: true },
    }),
  });
  if (response.ok) return;
  const problems =
    ((await response.json().catch(() => ({}))) as {
      errors?: { code?: string; meta?: { param_name?: string } }[];
    }).errors || [];
  // Someone made the account a moment ago.
  if (problems.some((problem) => problem.code === 'form_identifier_exists'))
    return;
  if (
    response.status === 422 &&
    problems.some((problem) => problem.meta?.param_name === 'email_address')
  )
    throw new CardError(400, 'email');
  // Codes such as form_password_required say what the sign-in service still
  // needs (docs/hosting.md). They name no person.
  console.error(
    JSON.stringify({
      event: 'family_card_account_failed',
      status: response.status,
      codes: problems.map((problem) => problem.code),
    }),
  );
  throw new CardError(503, 'unavailable');
}

/** Remove the account this site made for an address a card no longer names:
 * only an account made for a card, that nobody ever signed in with, at an
 * address no card names and flyleaf.json does not invite. */
async function removeUnused(env: Env, email: string) {
  try {
    if (listed(env.ALLOWED_EMAILS, email)) return;
    const named = await env.SUBMISSIONS_DB.prepare(
      'SELECT 1 FROM cards WHERE email = ?1 LIMIT 1',
    )
      .bind(email)
      .first();
    if (named) return;
    for (const account of await accounts(env, email))
      if (
        account.private_metadata?.flyleaf_card === true &&
        account.last_sign_in_at === null
      )
        await clerk(env, 'users/' + encodeURIComponent(account.id), {
          method: 'DELETE',
        });
  } catch {
    console.error(JSON.stringify({ event: 'family_card_cleanup_failed' }));
  }
}

/** The three card steps, each a POST of JSON to /api/card/<step>:
 *   check    { code }         the first name on the card, or that it is used
 *   email    { code, email }  choose the email; the account is made
 *   confirm  { code }         after signing in with that email: let it in
 * `session` is the signed-in reader's verified email, for confirm. */
export async function cardRequest(
  request: Request,
  env: Env,
  session?: { email: string },
  now = Date.now(),
): Promise<Response> {
  const step = new URL(request.url).pathname.slice('/api/card/'.length);
  if (
    !cardsOn(env) ||
    request.method !== 'POST' ||
    !['check', 'email', 'confirm'].includes(step)
  )
    return reply(404, { error: 'not-found' });
  if (step === 'confirm' && !session) return reply(401, { error: 'sign-in' });
  const body = await readBody(request);
  if (!body) return reply(400, { error: 'request' });
  const { wait, card } = await lookUp(request, env, body.code, now);
  if (wait) {
    console.error(JSON.stringify({ event: 'family_card_limit', wait }));
    return reply(429, { error: 'too-many', wait });
  }
  if (!card) return reply(404, { error: 'no-match' });
  const db = env.SUBMISSIONS_DB;
  const used = card.confirmed_at !== null;
  if (step === 'check')
    return used
      ? reply(200, { used: true, hint: hint(card.email) })
      : reply(200, { firstName: card.first_name });
  if (step === 'confirm') {
    if (card.email !== session!.email)
      return reply(403, { error: 'other-email' });
    await db
      .prepare(
        'UPDATE cards SET confirmed_at = ?1 WHERE code_hash = ?2 AND email = ?3 ' +
          'AND confirmed_at IS NULL',
      )
      .bind(now, card.code_hash, session!.email)
      .run();
    // The email may have been changed elsewhere in the meantime: read the
    // card again before saying the reader is let in.
    const after = await db.prepare(CARD).bind(card.code_hash).first<Card>();
    if (!after || after.confirmed_at === null || after.email !== session!.email)
      return reply(403, { error: 'other-email' });
    holders.delete(session!.email);
    return reply(200, { allowed: true });
  }
  if (used) return reply(409, { error: 'used', hint: hint(card.email) });
  const email = body.email.trim().toLowerCase();
  if (!emailShape(email)) return reply(400, { error: 'email' });
  // A card may try a few addresses, not an endless list: each new address
  // can make an account. The change is counted before the account is made.
  const changed = card.email !== email;
  if (changed) {
    const counted = await db
      .prepare(
        'UPDATE cards SET email_changes = email_changes + 1 WHERE code_hash = ?1 ' +
          'AND confirmed_at IS NULL AND email_changes < ?2',
      )
      .bind(card.code_hash, policy.emailChanges)
      .run();
    if (counted.meta.changes !== 1)
      return reply(429, { error: 'too-many-emails' });
  }
  try {
    if (!(await accounts(env, email)).length)
      await createAccount(env, email, card);
  } catch (error) {
    if (changed)
      await db
        .prepare(
          'UPDATE cards SET email_changes = email_changes - 1 WHERE code_hash = ?1 ' +
            'AND email_changes > 0',
        )
        .bind(card.code_hash)
        .run();
    if (error instanceof CardError)
      return reply(error.status, { error: error.code });
    throw error;
  }
  // Saved only if the card still names the address it named when this
  // request began: of two requests at once, one wins and the other tidies up.
  const saved = await db
    .prepare(
      'UPDATE cards SET email = ?1, chosen_at = ?2 WHERE code_hash = ?3 ' +
        'AND confirmed_at IS NULL AND email IS ?4',
    )
    .bind(email, now, card.code_hash, card.email)
    .run();
  if (saved.meta.changes !== 1) {
    await removeUnused(env, email);
    return reply(409, { error: 'busy' });
  }
  if (card.email && changed) await removeUnused(env, card.email);
  return reply(200, { email });
}

// Who a confirmed card's email is, remembered for a minute so that the many
// files of one page do not each ask the database.
const holders = new Map<string, { person: string; until: number }>();

/** The person a signed-in email is, when a confirmed card chose that email.
 * The holder of a blank card is let in as nobody in particular (person ''),
 * until the maintainer says who they are. A cancelled card stops opening the
 * site within a minute. A site that has cards off, and may never have had
 * them, treats a failed lookup as no card. */
export async function cardHolder(env: Env, email: string, now = Date.now()) {
  const known = holders.get(email);
  if (known && known.until > now) return { person: known.person };
  let row: { person: string } | null;
  try {
    row = await env.SUBMISSIONS_DB.prepare(
      'SELECT person FROM cards WHERE email = ?1 AND confirmed_at IS NOT NULL ' +
        'ORDER BY confirmed_at LIMIT 1',
    )
      .bind(email)
      .first<{ person: string }>();
  } catch (error) {
    if (cardsOn(env)) throw error;
    return null;
  }
  holders.delete(email);
  if (!row) return null;
  const person = blankCardNumber(row.person) ? '' : row.person;
  if (holders.size >= 500) holders.clear();
  holders.set(email, { person, until: now + 60_000 });
  return { person };
}

/** For the maintainer on the day: every card that still works or has been
 * used, and how far its holder has got. A card's code is never kept, so it
 * is not here. */
export async function cardStatus(env: Env, now = Date.now()) {
  const rows = await env.SUBMISSIONS_DB.prepare(
    'SELECT person, first_name, last_name, email, confirmed_at FROM cards ' +
      'WHERE confirmed_at IS NOT NULL OR expires_at > ?1 ' +
      'ORDER BY last_name, first_name, person',
  )
    .bind(now)
    .all<{
      person: string;
      first_name: string;
      last_name: string;
      email: string | null;
      confirmed_at: number | null;
    }>();
  return rows.results.map((row) => ({
    name: `${row.first_name} ${row.last_name}`.trim(),
    blank: blankCardNumber(row.person),
    person: blankCardNumber(row.person) ? '' : row.person,
    email: row.email || '',
    state: row.confirmed_at ? 'signed-in' : row.email ? 'email-chosen' : 'unused',
    signedInAt: row.confirmed_at,
  }));
}

/** Every person a card was made for, so the maintainer can see the site as
 * each of them before the card is used. Blank cards name nobody. */
export async function cardPeople(env: Env, now = Date.now()) {
  try {
    const rows = await env.SUBMISSIONS_DB.prepare(
      'SELECT DISTINCT person FROM cards WHERE confirmed_at IS NOT NULL OR expires_at > ?1',
    )
      .bind(now)
      .all<{ person: string }>();
    return rows.results
      .map((row) => row.person)
      .filter((person) => !blankCardNumber(person));
  } catch (error) {
    if (cardsOn(env)) throw error;
    return [];
  }
}
