import policy from '../shared/submission-policy.json' with { type: 'json' };
import { listed, site } from './site.ts';

export type Contributor = { userId: string; email: string };
type Submission = {
  id: string;
  user_id: string;
  email: string;
  kind: Kind;
  title: string;
  body: string;
  link: string;
  association: string;
  manifest_sha256: string;
  created_at: number;
  received_at: number | null;
  reviewed_at: number | null;
  reviewed_by: string | null;
};
type Attachment = {
  id: string;
  submission_id: string;
  ordinal: number;
  name: string;
  bytes: number;
  sha256: string;
  media_type: string;
  uploaded_at: number | null;
};
type Association = {
  kind: 'person' | 'source';
  id: string;
  label: string;
} | null;
type Kind = 'share' | 'correction';
type Manifest = {
  id: string;
  kind?: 'correction';
  title: string;
  text: string;
  link: string;
  association: Association;
  files: {
    id: string;
    name: string;
    bytes: number;
    sha256: string;
    mediaType: string;
  }[];
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const key = (submission: string, file: string) =>
  `originals/${submission}/${file}`;
const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const json = (value: unknown, status = 200) => Response.json(value, { status });
// Characters that change the direction text runs in. In a file name they can
// disguise its real ending: "photo<U+202E>gpj.exe" displays as "photoexe.jpg".
const directionMarks = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
class IntakeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, code: string, message: string): never {
  throw new IntakeError(status, code, message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(400, 'invalid', 'Please check the submission details.');
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      value,
    )
  )
    fail(400, 'invalid', 'A submission field is missing or too long.');
  return value;
}
async function readJSON(request: Request): Promise<unknown> {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim() !==
    'application/json'
  )
    fail(415, 'json', 'Please send the submission through the family form.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'empty', 'The submission is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        fail(413, 'too_large', 'The submission text is too large.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
          bytes,
        ),
      );
    } catch {
      return fail(400, 'invalid_json', 'The submission could not be read.');
    }
  } finally {
    reader.releaseLock();
  }
}
function manifest(value: unknown): Manifest {
  const input = object(value);
  if (
    Object.keys(input).some(
      (k) =>
        !['id', 'kind', 'title', 'text', 'link', 'association', 'files'].includes(
          k,
        ),
    )
  )
    fail(400, 'invalid', 'Unexpected submission field.');
  const id = string(input.id, 36);
  const kind = input.kind ?? 'share';
  if (kind !== 'share' && kind !== 'correction')
    fail(400, 'invalid', 'Please choose what kind of submission this is.');
  const title = string(input.title, policy.maxTitleLength);
  const text = string(input.text, policy.maxTextLength);
  const link = string(input.link, 2048);
  if (!uuid.test(id) || !title.trim())
    fail(400, 'invalid', 'Please give your submission a short title.');
  if (link) {
    try {
      const url = new URL(link);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
    } catch {
      fail(400, 'invalid_link', 'Please use a complete http or https link.');
    }
  }
  let association: Association = null;
  if (input.association !== null) {
    const a = object(input.association);
    if (!['person', 'source'].includes(String(a.kind)))
      fail(400, 'association', 'Please choose a person or source.');
    association = {
      kind: a.kind as 'person' | 'source',
      id: string(a.id, 160),
      label: string(a.label, 500),
    };
    if (!association.id || !association.label)
      fail(400, 'association', 'Please choose a person or source.');
  }
  if (!Array.isArray(input.files) || input.files.length > policy.maxFiles)
    fail(400, 'files', `Please send up to ${policy.maxFiles} files at a time.`);
  const files = input.files.map((value) => {
    const f = object(value);
    const file = {
      id: string(f.id, 36),
      name: string(f.name, 240),
      bytes: f.bytes as number,
      sha256: string(f.sha256, 64),
      mediaType: string(f.mediaType, 150),
    };
    if (
      !uuid.test(file.id) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !file.name ||
      directionMarks.test(file.name) ||
      Array.from(file.name).some(
        (c) =>
          c.charCodeAt(0) < 32 ||
          c.charCodeAt(0) === 127 ||
          c === '/' ||
          c === '\\',
      ) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > policy.maxFileBytes
    )
      fail(
        400,
        'file',
        'Please choose nonempty originals of up to 50 MB each, with ordinary filenames.',
      );
    return file;
  });
  if (
    new Set(files.map((f) => f.id)).size !== files.length ||
    files.reduce((sum, f) => sum + f.bytes, 0) > policy.maxSubmissionBytes
  )
    fail(400, 'files', 'Please send up to 150 MB in one submission.');
  if (!text.trim() && !link && !files.length)
    fail(400, 'empty', 'Please add a memory, correction, link or file.');
  // A plain share keeps its original shape, so earlier drafts still match.
  return {
    id,
    ...(kind === 'correction' && { kind }),
    title,
    text,
    link,
    association,
    files,
  };
}
function matches(head: R2Object | null, file: Attachment) {
  return (
    !!head &&
    head.size === file.bytes &&
    !!head.checksums.sha256 &&
    hex(head.checksums.sha256) === file.sha256
  );
}
function summary(s: Submission) {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    contributor: { userId: s.user_id, email: s.email },
    createdAt: s.created_at,
    receivedAt: s.received_at,
    reviewedAt: s.reviewed_at,
    status: s.reviewed_at
      ? 'reviewed'
      : s.received_at
        ? 'received'
        : 'uploading',
  };
}
async function detail(db: D1DatabaseSession, s: Submission) {
  const files = await db
    .prepare(
      'SELECT * FROM submission_files WHERE submission_id = ? ORDER BY ordinal',
    )
    .bind(s.id)
    .all<Attachment>();
  const reviews = await db
    .prepare(
      'SELECT reviewer_id, reviewed_at, action FROM submission_reviews WHERE submission_id = ? ORDER BY id',
    )
    .bind(s.id)
    .all();
  return {
    ...summary(s),
    text: s.body,
    link: s.link,
    association: JSON.parse(s.association),
    manifestSha256: s.manifest_sha256,
    reviews: reviews.results,
    files: files.results.map((f) => ({
      id: f.id,
      name: f.name,
      bytes: f.bytes,
      sha256: f.sha256,
      mediaType: f.media_type,
      uploaded: f.uploaded_at !== null,
      downloadUrl: `/api/submissions/${s.id}/files/${f.id}`,
    })),
  };
}

export async function submissions(
  request: Request,
  env: Env,
  who: Contributor,
): Promise<Response> {
  try {
    if (!env.SUBMISSIONS_DB || !env.SUBMISSIONS_FILES)
      fail(
        503,
        'unavailable',
        'Sharing is being prepared. Please keep your originals and try again shortly.',
      );
    const db = env.SUBMISSIONS_DB.withSession('first-primary');
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      env.SUBMISSIONS_OPEN !== 'true'
    )
      fail(
        503,
        'paused',
        'Sending is temporarily paused. Your saved submissions remain available. Please keep your originals and try again later.',
      );
    const url = new URL(request.url);
    // The family's administrators review what relatives send.
    const reviewer = listed(env.ADMIN_EMAILS, who.email);
    const me = site().maintainer;
    const parts = url.pathname.split('/').slice(3);
    if (parts.length === 1 && parts[0] === '') parts.pop();
    if (!parts.length) {
      if (request.method === 'GET') {
        const queue = url.searchParams.get('scope') === 'review';
        if (queue && !reviewer)
          fail(403, 'forbidden', `Only ${me} can open the family review queue.`);
        const before = url.searchParams.get('before');
        let cursor: Submission | null = null;
        if (before) {
          if (!uuid.test(before))
            fail(400, 'cursor', 'Please reopen the submission list.');
          cursor = await db
            .prepare('SELECT * FROM submissions WHERE id = ?')
            .bind(before)
            .first<Submission>();
          if (!cursor || (!queue && cursor.user_id !== who.userId))
            fail(400, 'cursor', 'Please reopen the submission list.');
        }
        const where = queue ? '1 = 1' : 'user_id = ?';
        const bindings: (string | number)[] = queue ? [] : [who.userId];
        if (cursor)
          bindings.push(cursor.created_at, cursor.created_at, cursor.id);
        const rows = await db
          .prepare(
            `SELECT * FROM submissions WHERE ${where}${cursor ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT 26`,
          )
          .bind(...bindings)
          .all<Submission>();
        const items = rows.results.slice(0, 25);
        return json({
          viewer: { ...who, reviewer },
          limits: policy,
          items: items.map(summary),
          next: rows.results.length > 25 ? items[24].id : null,
        });
      }
      if (request.method !== 'POST') fail(405, 'method', 'Method not allowed.');
      const input = manifest(await readJSON(request));
      const digest = hex(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(input)),
        ),
      );
      const existing = () =>
        db
          .prepare('SELECT * FROM submissions WHERE id = ?')
          .bind(input.id)
          .first<Submission>();
      let row = await existing();
      const now = Date.now();
      if (!row) {
        try {
          await db.batch([
            db
              .prepare(
                'INSERT INTO submissions (id, user_id, email, kind, title, body, link, association, manifest_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              )
              .bind(
                input.id,
                who.userId,
                who.email,
                input.kind ?? 'share',
                input.title,
                input.text,
                input.link,
                JSON.stringify(input.association),
                digest,
                now,
              ),
            ...input.files.map((f, ordinal) =>
              db
                .prepare(
                  'INSERT INTO submission_files (id, submission_id, ordinal, name, bytes, sha256, media_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
                )
                .bind(
                  f.id,
                  input.id,
                  ordinal,
                  f.name,
                  f.bytes,
                  f.sha256,
                  f.mediaType,
                ),
            ),
          ]);
        } catch (error) {
          row = await existing(); // A concurrent identical retry may have won.
          if (!row) {
            const reason = String(error);
            if (reason.includes('FAMILY_DAILY_LIMIT'))
              fail(
                429,
                'daily_limit',
                'You have sent ten submissions today. Please continue tomorrow; unfinished submissions can still be completed.',
              );
            if (reason.includes('FAMILY_DAILY_BYTES_LIMIT'))
              fail(
                429,
                'daily_bytes',
                `You can send up to ${policy.maxDailyBytes / 1_000_000} MB of files a day, and this would go over. Please send the rest tomorrow; unfinished submissions can still be completed.`,
              );
            if (/FAMILY_(STORAGE|SUBMISSIONS)_LIMIT/.test(reason))
              fail(
                507,
                'capacity',
                `The family inbox is full. Please keep your originals and let ${me} know.`,
              );
            throw error;
          }
        }
        row ||= await existing();
      }
      if (!row) throw Error('Missing committed submission');
      if (row.user_id !== who.userId || row.manifest_sha256 !== digest)
        fail(
          409,
          'conflict',
          'This submission has already been saved with different details. Open it from Your submissions or start a new one.',
        );
      return json(await detail(db, row));
    }
    if (!uuid.test(parts[0])) fail(404, 'missing', 'Submission not found.');
    const row = await db
      .prepare('SELECT * FROM submissions WHERE id = ?')
      .bind(parts[0])
      .first<Submission>();
    if (!row || (row.user_id !== who.userId && !reviewer))
      fail(404, 'missing', 'Submission not found.');
    const owner = row.user_id === who.userId;
    if (parts.length === 1 && request.method === 'GET') {
      const response = json(await detail(db, row));
      if (url.searchParams.get('download') === '1')
        response.headers.set(
          'Content-Disposition',
          `attachment; filename="submission-${row.id}.json"`,
        );
      return response;
    }
    if (parts.length === 3 && parts[1] === 'files' && uuid.test(parts[2])) {
      const file = await db
        .prepare(
          'SELECT * FROM submission_files WHERE submission_id = ? AND id = ?',
        )
        .bind(row.id, parts[2])
        .first<Attachment>();
      if (!file) fail(404, 'missing', 'File not found.');
      const objectKey = key(row.id, file.id);
      if (['GET', 'HEAD'].includes(request.method)) {
        const original =
          request.method === 'HEAD'
            ? null
            : await env.SUBMISSIONS_FILES.get(objectKey);
        const object =
          request.method === 'HEAD'
            ? await env.SUBMISSIONS_FILES.head(objectKey)
            : original;
        if (!object)
          fail(404, 'missing', 'This original has not finished uploading.');
        if (!matches(object, file)) {
          await original?.body.cancel();
          fail(
            503,
            'integrity',
            `This original needs a preservation check. Please contact ${me}.`,
          );
        }
        return new Response(original?.body || null, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(file.bytes),
            'Content-Disposition': `attachment; filename="original"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
            ETag: object.httpEtag,
          },
        });
      }
      if (request.method !== 'PUT') fail(405, 'method', 'Method not allowed.');
      if (!owner)
        fail(403, 'forbidden', 'Only the contributor can finish this upload.');
      const head = await env.SUBMISSIONS_FILES.head(objectKey);
      if (!head) {
        if (row.received_at)
          fail(409, 'received', 'This submission has already been received.');
        if (!request.body)
          fail(400, 'empty_file', 'Please select the original file again.');
        const length = request.headers.get('Content-Length');
        if (length !== null && Number(length) !== file.bytes)
          fail(400, 'length', 'The selected original has a different length.');
        const fixed = new FixedLengthStream(file.bytes);
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 180000);
        const pumping = request.body.pipeTo(fixed.writable, {
          signal: stop.signal,
        });
        // Always observe rejection, including while R2 is still consuming.
        void pumping.catch(() => {});
        try {
          const stored = await env.SUBMISSIONS_FILES.put(
            objectKey,
            fixed.readable,
            {
              sha256: file.sha256,
              onlyIf: new Headers({ 'If-None-Match': '*' }),
              httpMetadata: { contentType: 'application/octet-stream' },
            },
          );
          if (!stored) stop.abort();
          else await pumping;
        } catch {
          // Do not free capacity: a lost response can follow a committed write.
          fail(
            422,
            'upload',
            'The original did not finish transferring. Retry with the same file.',
          );
        } finally {
          clearTimeout(timer);
          stop.abort();
          await pumping.catch(() => {});
        }
      }
      if (!matches(await env.SUBMISSIONS_FILES.head(objectKey), file))
        fail(
          409,
          'file_conflict',
          `The stored original does not match this submission. Please contact ${me}.`,
        );
      await db
        .prepare(
          'UPDATE submission_files SET uploaded_at = coalesce(uploaded_at, ?) WHERE submission_id = ? AND id = ?',
        )
        .bind(Date.now(), row.id, file.id)
        .run();
      return json({ uploaded: true });
    }
    if (
      parts.length === 2 &&
      parts[1] === 'complete' &&
      request.method === 'POST'
    ) {
      if (!owner)
        fail(
          403,
          'forbidden',
          'Only the contributor can finish this submission.',
        );
      const files = await db
        .prepare(
          'SELECT * FROM submission_files WHERE submission_id = ? ORDER BY ordinal',
        )
        .bind(row.id)
        .all<Attachment>();
      for (const file of files.results)
        if (
          !matches(await env.SUBMISSIONS_FILES.head(key(row.id, file.id)), file)
        )
          fail(
            409,
            'incomplete',
            'Some originals have not finished uploading. Please resume this submission.',
          );
      await db.batch([
        db
          .prepare(
            'UPDATE submission_files SET uploaded_at = coalesce(uploaded_at, ?) WHERE submission_id = ?',
          )
          .bind(Date.now(), row.id),
        db
          .prepare(
            'UPDATE submissions SET received_at = coalesce(received_at, ?) WHERE id = ?',
          )
          .bind(Date.now(), row.id),
      ]);
      const saved = await db
        .prepare('SELECT * FROM submissions WHERE id = ?')
        .bind(row.id)
        .first<Submission>();
      if (!saved?.received_at) throw Error('Missing completion');
      return json(await detail(db, saved));
    }
    if (
      parts.length === 2 &&
      parts[1] === 'review' &&
      request.method === 'POST'
    ) {
      if (!reviewer) fail(403, 'forbidden', `Only ${me} can review submissions.`);
      if (!row.received_at)
        fail(
          409,
          'incomplete',
          'The contributor is still sending this submission.',
        );
      const input = object(await readJSON(request));
      if (typeof input.reviewed !== 'boolean')
        fail(400, 'review', 'Please choose a review state.');
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            `INSERT INTO submission_reviews (submission_id, reviewer_id, reviewed_at, action) SELECT id, ?, ?, ? FROM submissions WHERE id = ? AND reviewed_at IS ${input.reviewed ? '' : 'NOT '}NULL`,
          )
          .bind(
            who.userId,
            now,
            input.reviewed ? 'reviewed' : 'reopened',
            row.id,
          ),
        db
          .prepare(
            `UPDATE submissions SET reviewed_at = ?, reviewed_by = ? WHERE id = ? AND reviewed_at IS ${input.reviewed ? '' : 'NOT '}NULL`,
          )
          .bind(
            input.reviewed ? now : null,
            input.reviewed ? who.userId : null,
            row.id,
          ),
      ]);
      return json({ reviewed: input.reviewed });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof IntakeError)
      return json({ error: error.message, code: error.code }, error.status);
    console.error(JSON.stringify({ event: 'family_submission_unavailable' }));
    return json(
      {
        error:
          'Sharing is temporarily unavailable. Your saved submission can be retried without sending a duplicate.',
        code: 'unavailable',
      },
      503,
    );
  }
}
