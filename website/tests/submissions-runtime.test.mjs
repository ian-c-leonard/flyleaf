import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { clerkFixture } from './helpers/clerk-fixture.mjs';
import { applySubmissionSchema } from './helpers/submission-schema.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const owner = { sub: 'user_relative', email: 'relative@example.com' };
const other = { sub: 'user_other', email: 'other@example.com' };
const original = Buffer.from('Unchanged original photograph bytes.');
const submission = (files = true) => ({
  id: randomUUID(),
  title: 'A photograph from home',
  text: 'Mum wrote “summer” on the back.\n\nI don’t know the year.  ',
  link: '',
  association: { kind: 'person', id: 'I0017', label: 'Tamsin' },
  files: files
    ? [
        {
          id: randomUUID(),
          name: 'Mum’s photograph.jpg',
          bytes: original.length,
          sha256: sha(original),
          mediaType: 'image/jpeg',
        },
      ]
    : [],
});

void test('durable submissions through the actual Clerk/Worker/D1/R2 runtime', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'family-intake-'));
  await writeFile(join(temporary, 'index.html'), 'PRIVATE FAMILY');
  const f = await clerkFixture(temporary, {
    ALLOWED_EMAILS: 'ada@example.org,relative@example.com,other@example.com',
    ADMIN_EMAILS: 'ada@example.org',
  });
  const db = await f.mf.getD1Database('SUBMISSIONS_DB');
  const bucket = await f.mf.getR2Bucket('SUBMISSIONS_FILES');
  try {
    await applySubmissionSchema(db);
    async function request(
      path,
      method = 'GET',
      body,
      claims = owner,
      extraHeaders = {},
    ) {
      const headers = {
        Cookie: f.cookie(await f.token(claims)),
        Origin: 'https://example.family',
        ...extraHeaders,
      };
      if (body && !Buffer.isBuffer(body))
        headers['Content-Type'] = 'application/json';
      return f.req('/api/submissions' + path, {
        method,
        headers,
        body: body && (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
      });
    }
    const create = (input, claims) => request('', 'POST', input, claims);
    const complete = (id, claims) =>
      request('/' + id + '/complete', 'POST', undefined, claims);
    const path = (s) => '/' + s.id + '/files/' + s.files[0].id;
    await t.test(
      'anonymous, cross-origin and uninvited writes fail before storage; writes never redirect',
      async () => {
        const body = JSON.stringify(submission());
        for (const Origin of ['https://evil.example', 'null', '']) {
          const r = await request('', 'POST', submission(), owner, { Origin });
          assert.equal(r.status, 403);
        }
        const anonymous = await f.req('/api/submissions', {
          method: 'POST',
          headers: {
            Origin: 'https://example.family',
            'Content-Type': 'application/json',
          },
          body,
        });
        assert.equal(anonymous.status, 401);
        assert.equal(anonymous.headers.get('Location'), null);
        const denied = await create(submission(), {
          sub: 'uninvited',
          email: 'uninvited@example.com',
        });
        assert.equal(denied.status, 403);
        const expired = await create(submission(), {
          ...owner,
          exp: Math.floor(Date.now() / 1000) - 20,
        });
        assert.equal(expired.status, 401);
        assert.equal(expired.headers.get('Location'), null);
        assert.equal(
          (await db.prepare('SELECT count(*) AS n FROM submissions').first()).n,
          0,
        );
      },
    );
    let saved;
    await t.test(
      'atomic create, immutable text/identity, idempotent retries and original download',
      async () => {
        saved = submission();
        const responses = await Promise.all([create(saved), create(saved)]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [200, 200],
        );
        const initial = await responses[0].json();
        assert.equal(initial.text, saved.text);
        assert.equal(initial.contributor.email, owner.email);
        assert.equal(initial.status, 'uploading');
        const cap = await db
          .prepare('SELECT * FROM submission_capacity')
          .first();
        assert.equal(cap.submission_count, 1);
        assert.equal(cap.reserved_bytes, original.length + 65536);
        assert.equal((await create({ ...saved, text: 'Changed' })).status, 409);
        assert.equal((await complete(saved.id)).status, 409);
        const upload = await request(path(saved), 'PUT', original);
        assert.equal(upload.status, 200, await upload.text());
        assert.equal((await request(path(saved), 'PUT', original)).status, 200);
        const done = await complete(saved.id);
        assert.equal(done.status, 200);
        assert.equal((await done.json()).status, 'received');
        const download = await request(path(saved));
        assert.equal(download.status, 200);
        assert.equal(
          sha(Buffer.from(await download.arrayBuffer())),
          sha(original),
        );
        assert.equal(
          download.headers.get('Cache-Control'),
          'private, no-store',
        );
        assert.match(
          download.headers.get('Content-Disposition'),
          /^attachment;/,
        );
        assert.equal(
          download.headers.get('Content-Type'),
          'application/octet-stream',
        );
        const head = await request(path(saved), 'HEAD');
        assert.equal(head.status, 200);
        assert.equal(
          head.headers.get('Content-Length'),
          String(original.length),
        );
        await assert.rejects(
          () =>
            db
              .prepare('UPDATE submissions SET body = ? WHERE id = ?')
              .bind('Changed', saved.id)
              .run(),
          /IMMUTABLE/,
        );
      },
    );
    await t.test(
      'other relatives cannot list, inspect, upload, complete or review another contribution',
      async () => {
        for (const p of [
          '/' + saved.id,
          path(saved),
          '/' + saved.id + '?download=1',
        ])
          assert.equal((await request(p, 'GET', undefined, other)).status, 404);
        assert.equal(
          (await request('?scope=review', 'GET', undefined, other)).status,
          403,
        );
        assert.deepEqual(
          (await (await request('', 'GET', undefined, other)).json()).items,
          [],
        );
        assert.equal(
          (await request(path(saved), 'PUT', original, other)).status,
          404,
        );
        assert.equal((await complete(saved.id, other)).status, 404);
        assert.equal(
          (
            await request(
              '/' + saved.id + '/review',
              'POST',
              { reviewed: true },
              owner,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request('', 'POST', {
              ...submission(false),
              email: 'ada@example.org',
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      'The maintainer can review and export without changing original text; review history is preserved',
      async () => {
        const list = await (
          await request('?scope=review', 'GET', undefined, {})
        ).json();
        assert.equal(list.viewer.reviewer, true);
        assert.equal(list.items.length, 1);
        assert.equal(
          (
            await request(
              '/' + saved.id + '/review',
              'POST',
              { reviewed: true },
              {},
            )
          ).status,
          200,
        );
        const detail = await (
          await request('/' + saved.id + '?download=1', 'GET', undefined, {})
        ).json();
        assert.equal(detail.text, saved.text);
        assert.equal(detail.status, 'reviewed');
        assert.equal(detail.reviews.length, 1);
        assert.equal(
          (
            await request(
              '/' + saved.id + '/review',
              'POST',
              { reviewed: false },
              {},
            )
          ).status,
          200,
        );
        assert.equal(
          (await (await request('/' + saved.id, 'GET', undefined, {})).json())
            .reviews.length,
          2,
        );
      },
    );
    await t.test(
      'wrong hash/length cannot commit; interrupted transfer retains quota and resumes',
      async () => {
        const s = submission();
        assert.equal((await create(s)).status, 200);
        assert.equal(
          (await request(path(s), 'PUT', Buffer.alloc(original.length, 3)))
            .status,
          422,
        );
        assert.equal(
          await bucket.head(`originals/${s.id}/${s.files[0].id}`),
          null,
        );
        // No declared HTTP length: the fixed-length stream rejects actual bytes.
        assert.equal(
          (await request(path(s), 'PUT', Buffer.from('short'))).status,
          422,
        );
        assert.equal(
          (await request(path(s), 'PUT', Buffer.alloc(original.length + 1)))
            .status,
          422,
        );
        assert.equal((await complete(s.id)).status, 409);
        assert.equal((await request(path(s), 'PUT', original)).status, 200);
        // R2 committed but its D1 marker was lost: completion reconciles the object.
        await db
          .prepare(
            'UPDATE submission_files SET uploaded_at = NULL WHERE submission_id = ?',
          )
          .bind(s.id)
          .run();
        const finished = await complete(s.id);
        assert.equal(finished.status, 200);
        assert.equal((await finished.json()).files[0].uploaded, true);
      },
    );
    await t.test(
      'concurrent capacity limits roll back failed metadata and allow exact retries at capacity',
      async () => {
        const charge = original.length + 65536;
        await db
          .prepare('UPDATE submission_capacity SET reserved_bytes = ?')
          .bind(1_000_000_000 - charge)
          .run();
        const left = submission();
        const right = submission();
        const results = await Promise.all([create(left), create(right)]);
        assert.deepEqual(
          results.map((r) => r.status).sort((a, b) => a - b),
          [200, 507],
        );
        const winner = results[0].status === 200 ? left : right;
        const loser = results[0].status === 200 ? right : left;
        assert.equal((await create(winner)).status, 200);
        assert.equal(
          await db
            .prepare('SELECT id FROM submissions WHERE id = ?')
            .bind(loser.id)
            .first(),
          null,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT reserved_bytes AS n FROM submission_capacity')
              .first()
          ).n,
          1_000_000_000,
        );
        await db
          .prepare(
            'UPDATE submission_capacity SET reserved_bytes = (SELECT sum(bytes + 65536) FROM submission_files)',
          )
          .run();
      },
    );
    await t.test(
      'text-only completion, indexed daily limit and duplicate retry at daily limit',
      async () => {
        const first = submission(false);
        assert.equal((await create(first, other)).status, 200);
        assert.equal((await complete(first.id, other)).status, 200);
        for (let i = 1; i < 10; i++)
          assert.equal((await create(submission(false), other)).status, 200);
        assert.equal((await create(submission(false), other)).status, 429);
        assert.equal((await create(first, other)).status, 200);
      },
    );
    await t.test(
      'a suggested correction keeps its kind; plain shares keep their original shape',
      async () => {
        const corrector = { sub: 'user_corrector', email: owner.email };
        const fix = {
          ...submission(false),
          kind: 'correction',
          title: 'Correction for Tamsin',
          text: 'Her middle name is spelled differently.',
        };
        const made = await create(fix, corrector);
        assert.equal(made.status, 200, await made.clone().text());
        assert.equal((await made.json()).kind, 'correction');
        assert.equal((await create(fix, corrector)).status, 200);
        const { kind: _kind, ...asShare } = fix;
        assert.equal((await create(asShare, corrector)).status, 409);
        const row = await db
          .prepare('SELECT kind FROM submissions WHERE id = ?')
          .bind(fix.id)
          .first();
        assert.equal(row.kind, 'correction');
        await assert.rejects(
          db
            .prepare("UPDATE submissions SET kind = 'share' WHERE id = ?")
            .bind(fix.id)
            .run(),
          /FAMILY_ORIGINAL_IMMUTABLE/,
        );
        const plain = submission(false);
        const shared = await create(plain, corrector);
        assert.equal((await shared.json()).kind, 'share');
        assert.equal(
          (await create({ ...plain, kind: 'share' }, corrector)).status,
          200,
        );
        assert.equal(
          (await create({ ...submission(false), kind: 'gossip' }, corrector))
            .status,
          400,
        );
        const list = await (await request('', 'GET', undefined, corrector)).json();
        assert.deepEqual(
          list.items.map((item) => item.kind).sort(),
          ['correction', 'share'],
        );
      },
    );
    await t.test(
      'a file name with text-direction marks is refused before storage',
      async () => {
        const sender = { sub: 'user_names', email: owner.email };
        for (const mark of ['\u202E', '\u2066', '\u200F', '\u061C']) {
          const input = submission();
          input.files[0].name = `photo${mark}gpj.exe`;
          const response = await create(input, sender);
          assert.equal(response.status, 400, JSON.stringify(mark));
          assert.equal((await response.json()).code, 'file');
          assert.equal(
            await db
              .prepare('SELECT id FROM submissions WHERE id = ?')
              .bind(input.id)
              .first(),
            null,
          );
        }
        const plain = submission();
        plain.files[0].name = 'Grandad’s café, 1952 (front).jpg';
        assert.equal((await create(plain, sender)).status, 200);
      },
    );
    await t.test(
      'one relative can send up to the daily amount of files, then must wait',
      async () => {
        const policy = JSON.parse(
          await readFile('shared/submission-policy.json', 'utf8'),
        );
        // The database trigger and the Worker's message share one limit.
        const migration = await readFile(
          'migrations/submissions/0003_daily_bytes.sql',
          'utf8',
        );
        assert.match(migration, new RegExp(`> ${policy.maxDailyBytes};`));
        const sender = { sub: 'user_daily_bytes', email: owner.email };
        const large = (count, bytes) => ({
          ...submission(false),
          files: Array.from({ length: count }, (_, i) => ({
            id: randomUUID(),
            name: `scan ${i + 1}.tif`,
            bytes,
            sha256: 'b'.repeat(64),
            mediaType: 'image/tiff',
          })),
        });
        const share = policy.maxSubmissionBytes;
        const fit = Math.floor(policy.maxDailyBytes / share);
        const first = large(3, share / 3);
        assert.equal((await create(first, sender)).status, 200);
        for (let i = 1; i < fit; i++)
          assert.equal((await create(large(3, share / 3), sender)).status, 200);
        const over = await create(large(1, 1), sender);
        assert.equal(over.status, 429);
        const refused = await over.json();
        assert.equal(refused.code, 'daily_bytes');
        assert.match(refused.error, /up to 300 MB of files a day/);
        // A retry of a saved submission still works, and other relatives
        // and text-only notes are not affected.
        assert.equal((await create(first, sender)).status, 200);
        assert.equal(
          (await create(large(1, 1), { sub: 'user_fresh', email: owner.email }))
            .status,
          200,
        );
        assert.equal((await create(submission(false), sender)).status, 200);
        // Reserved storage returns to what the saved files hold.
        await db
          .prepare(
            'UPDATE submission_capacity SET reserved_bytes = (SELECT sum(bytes + 65536) FROM submission_files)',
          )
          .run();
      },
    );
    await t.test(
      'maintenance pause rejects writes while private reads remain available',
      async () => {
        const paused = await clerkFixture(temporary, {
          SUBMISSIONS_OPEN: 'false',
        });
        try {
          await applySubmissionSchema(
            await paused.mf.getD1Database('SUBMISSIONS_DB'),
          );
          const headers = {
            Cookie: paused.cookie(await paused.token()),
            Origin: 'https://example.family',
            'Content-Type': 'application/json',
          };
          assert.equal(
            (await paused.req('/api/submissions', { headers })).status,
            200,
          );
          for (const [routePath, method] of [
            ['', 'POST'],
            [`/${saved.id}/complete`, 'POST'],
            [`/${saved.id}/review`, 'POST'],
            [path(saved), 'PUT'],
          ]) {
            const result = await paused.req('/api/submissions' + routePath, {
              method,
              headers,
              body: '{}',
            });
            assert.equal(result.status, 503);
            assert.equal((await result.json()).code, 'paused');
          }
        } finally {
          await paused.dispose();
        }
      },
    );
  } finally {
    await f.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
