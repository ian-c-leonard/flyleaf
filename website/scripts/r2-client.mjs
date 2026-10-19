import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  S3Client,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { FamilyError, readSettings } from '../flyleaf-settings.mjs';

const { cloudflare } = readSettings();
export const ARCHIVE_TARGET = Object.freeze({
  account: cloudflare.account_id,
  bucket: cloudflare.archive_bucket,
  jurisdiction: 'default',
});
// What relatives send. Nothing here writes to it, but it must stay private.
export const SUBMISSIONS_BUCKET = cloudflare.submissions_bucket;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function withDeadline(operation, timeoutMs = 300_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid transfer deadline.');
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        Object.assign(new Error('File transfer deadline exceeded.'), {
          name: 'TimeoutError',
        }),
      ),
    timeoutMs,
  );
  try {
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}
export function transient(error) {
  return (
    [408, 409, 429, 500, 502, 503, 504].includes(
      error.$metadata?.httpStatusCode ?? error.status,
    ) ||
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
    ].includes(error.code) ||
    ['TimeoutError', 'RequestTimeout', 'SlowDown'].includes(error.name)
  );
}

export async function retry(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 3 || !transient(error)) throw error;
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  }
}

async function send(client, command, signal) {
  return signal
    ? client.send(command, { abortSignal: signal })
    : withDeadline(
        (deadline) => client.send(command, { abortSignal: deadline }),
        30_000,
      );
}

export async function collectObjects(client, bucket) {
  const objects = [];
  const seen = new Set();
  const cursors = new Set();
  let token;
  let more;
  do {
    const page = await send(
      client,
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    if (
      typeof page.IsTruncated !== 'boolean' ||
      (page.Contents !== undefined && !Array.isArray(page.Contents)) ||
      (page.KeyCount !== undefined &&
        (!Number.isSafeInteger(page.KeyCount) ||
          page.KeyCount !== (page.Contents?.length ?? 0)))
    ) {
      throw new Error('Malformed S3 inventory page.');
    }
    for (const object of page.Contents ?? []) {
      if (
        typeof object.Key !== 'string' ||
        !Number.isSafeInteger(object.Size) ||
        object.Size < 0 ||
        seen.has(object.Key)
      ) {
        throw new Error('Invalid or duplicate S3 object.');
      }
      seen.add(object.Key);
      objects.push({
        key: object.Key,
        bytes: object.Size,
        etag: object.ETag,
        storageClass: object.StorageClass,
      });
    }
    more = page.IsTruncated;
    if (!more) break;
    if (
      typeof page.NextContinuationToken !== 'string' ||
      !page.NextContinuationToken ||
      cursors.has(page.NextContinuationToken)
    )
      throw new Error('Incomplete S3 pagination.');
    token = page.NextContinuationToken;
    cursors.add(token);
  } while (more);
  return objects;
}

export function metricBytes(metrics) {
  let total = 0;
  for (const storage of ['standard', 'infrequentAccess']) {
    for (const state of ['uploaded', 'published']) {
      for (const field of ['payloadSize', 'metadataSize', 'objects']) {
        const value = metrics?.[storage]?.[state]?.[field];
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error('Incomplete account metrics.');
        if (field !== 'objects') total += value;
      }
    }
  }
  if (!Number.isSafeInteger(total))
    throw new Error('Account metrics overflow.');
  return total;
}

function contentType(key) {
  const ext = key.split('.').at(-1).toLowerCase();
  return (
    {
      pdf: 'application/pdf',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      opus: 'audio/ogg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      aif: 'audio/aiff',
      aiff: 'audio/aiff',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      gif: 'image/gif',
      json: 'application/json',
      txt: 'text/plain; charset=utf-8',
      html: 'text/plain; charset=utf-8',
      htm: 'text/plain; charset=utf-8',
      svg: 'application/octet-stream',
    }[ext] ?? 'application/octet-stream'
  );
}

export class R2Archive {
  constructor(token, target = ARCHIVE_TARGET) {
    if (
      !token ||
      target.account !== ARCHIVE_TARGET.account ||
      target.bucket !== ARCHIVE_TARGET.bucket ||
      target.jurisdiction !== ARCHIVE_TARGET.jurisdiction
    )
      throw new Error('Missing credentials or unexpected archive target.');
    this.token = token;
    this.target = target;
    this.clients = new Map();
  }

  async rest(route, jurisdiction, tolerate = false) {
    const response = await retry(async () => {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.target.account}${route}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(jurisdiction ? { 'cf-r2-jurisdiction': jurisdiction } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (r.status === 429 || r.status >= 500) {
        await r.body?.cancel();
        throw Object.assign(
          new Error('Cloudflare read failed: HTTP ' + r.status),
          { status: r.status },
        );
      }
      return r;
    });
    const body = await response.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      data = { body };
    }
    const result = { status: response.status, ...data };
    if (!tolerate && (response.status !== 200 || data.success !== true)) {
      throw new Error(
        `Cloudflare read failed: ${route.split('?')[0]}, HTTP ${response.status}`,
      );
    }
    return result;
  }

  async connect() {
    const verification = await this.rest('/tokens/verify');
    if (verification.result?.status !== 'active' || !verification.result?.id)
      throw new Error('Cloudflare token is not active.');
    this.tokenId = verification.result.id;
    // Cloudflare documents this mapping for account API tokens. Neither derived
    // credential is written to disk, printed, or placed in an argument list.
    this.credentials = {
      accessKeyId: this.tokenId,
      secretAccessKey: createHash('sha256').update(this.token).digest('hex'),
    };
    return this;
  }

  client(jurisdiction = this.target.jurisdiction) {
    if (!this.credentials) throw new Error('Connect before using R2.');
    if (!['default', 'eu', 'us', 'fedramp'].includes(jurisdiction))
      throw new Error('Unsupported S3 jurisdiction.');
    if (!this.clients.has(jurisdiction)) {
      const suffix = jurisdiction === 'default' ? '' : '.' + jurisdiction;
      this.clients.set(
        jurisdiction,
        new S3Client({
          region: 'auto',
          endpoint: `https://${this.target.account}${suffix}.r2.cloudflarestorage.com`,
          forcePathStyle: true,
          credentials: this.credentials,
          maxAttempts: 1,
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          requestHandler: { connectionTimeout: 30_000, socketTimeout: 120_000 },
        }),
      );
    }
    return this.clients.get(jurisdiction);
  }

  async bucketPages(jurisdiction) {
    const buckets = [];
    const cursors = new Set();
    let cursor = '';
    do {
      const page = await this.rest(
        '/r2/buckets?per_page=1000' +
          (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        jurisdiction,
        true,
      );
      if (page.status !== 200 || page.success !== true) {
        if (cursor)
          throw new Error(
            'Bucket pagination failed after a successful page: ' + jurisdiction,
          );
        return { jurisdiction, ...page };
      }
      if (!Array.isArray(page.result?.buckets))
        throw new Error('Invalid bucket listing.');
      for (const bucket of page.result.buckets) {
        if (
          !bucket.name ||
          (bucket.jurisdiction && bucket.jurisdiction !== jurisdiction) ||
          buckets.some((b) => b.name === bucket.name)
        ) {
          throw new Error('Invalid or duplicate bucket identity.');
        }
        buckets.push({ name: bucket.name, jurisdiction });
      }
      cursor = page.result_info?.cursor;
      if (cursor && cursors.has(cursor))
        throw new Error('Incomplete bucket pagination.');
      cursors.add(cursor);
    } while (cursor);
    return { jurisdiction, status: 200, success: true, buckets };
  }

  async scopeEvidence() {
    const account = (await this.rest('')).result;
    const subscriptions = [];
    for (let page = 1; ; page++) {
      const response = await this.rest(
        '/subscriptions?per_page=50&page=' + page,
      );
      if (!Array.isArray(response.result))
        throw new Error('Incomplete subscription evidence.');
      subscriptions.push(...response.result);
      if (response.result_info?.total_pages > page) continue;
      if (
        response.result_info?.total_count !== undefined &&
        response.result_info.total_count !== subscriptions.length
      ) {
        throw new Error('Incomplete subscription pagination.');
      }
      break;
    }
    const policy = (await this.rest('/tokens/' + this.tokenId)).result;
    const policies = policy?.policies;
    const accountScope = `com.cloudflare.api.account.${this.target.account}`;
    if (
      !Array.isArray(policies) ||
      policies.some((p) => p.effect !== 'allow') ||
      !policies.some(
        (p) =>
          p.resources?.[accountScope] === '*' &&
          p.permission_groups?.some(
            (g) => g.name === 'Workers R2 Storage Write',
          ),
      )
    ) {
      throw new Error(
        'Need account-wide R2 inventory and write permission without a deny.',
      );
    }
    return {
      accountType: account?.type,
      accountWideR2Write: true,
      subscriptions: subscriptions.map((s) => ({
        state: s.state,
        plan: s.rate_plan?.id,
        isContract: s.rate_plan?.is_contract,
      })),
      nonEnterprise:
        account?.type === 'standard' &&
        subscriptions.length > 0 &&
        subscriptions.every((s) => s.rate_plan?.is_contract === false),
    };
  }

  async inventory() {
    const startedAt = new Date().toISOString();
    const scope = await this.scopeEvidence();
    const jurisdictions = [];
    const buckets = [];
    for (const jurisdiction of [
      'default',
      'eu',
      'us',
      'fedramp',
      'fedramp-high',
    ]) {
      const observed = await this.bucketPages(jurisdiction);
      if (observed.status === 200 && observed.success) {
        if (jurisdiction === 'fedramp-high')
          throw new Error('New federal API support requires inventory review.');
        jurisdictions.push({
          jurisdiction,
          status: 200,
          bucketCount: observed.buckets.length,
          basis: 'observed',
        });
        buckets.push(...observed.buckets);
      } else if (
        jurisdiction === 'fedramp' &&
        scope.nonEnterprise &&
        observed.status === 403 &&
        observed.errors?.length === 1 &&
        observed.errors[0].code === 10003
      ) {
        jurisdictions.push({
          jurisdiction,
          status: 403,
          code: 10003,
          basis:
            'Inferred unavailable for this standard noncontract account; not an empty listing.',
          reference:
            'https://developers.cloudflare.com/r2/reference/data-location/',
        });
      } else if (
        jurisdiction === 'fedramp-high' &&
        scope.nonEnterprise &&
        observed.status === 400 &&
        observed.body?.trim() === 'BadRequest: invalid jurisdiction'
      ) {
        jurisdictions.push({
          jurisdiction,
          status: 400,
          basis:
            'Unsupported on this public control API; not an empty listing.',
        });
      } else
        throw new Error(
          'Unresolved storage jurisdiction: ' +
            jurisdiction +
            ', HTTP ' +
            observed.status,
        );
    }
    const metrics = (await this.rest('/r2/metrics')).result;
    for (const bucket of buckets) {
      const client = this.client(bucket.jurisdiction);
      bucket.objects = await retry(() => collectObjects(client, bucket.name));
      const pending = await retry(() =>
        send(
          client,
          new ListMultipartUploadsCommand({
            Bucket: bucket.name,
            MaxUploads: 1,
          }),
        ),
      );
      if (
        typeof pending.IsTruncated !== 'boolean' ||
        (pending.Uploads !== undefined && !Array.isArray(pending.Uploads))
      )
        throw new Error('Invalid multipart inventory.');
      // There is no multipart work in this uploader. Any pending upload is a
      // reason to stop, not permission to abort somebody else's upload.
      if (pending.IsTruncated || pending.Uploads?.length)
        throw new Error(
          'Pending multipart uploads require separate accounting.',
        );
      bucket.pendingUploads = 0;
    }
    const { details } = await this.checkPrivate();
    if (details.storage_class !== 'Standard')
      throw new Error(
        'Archive must be Standard storage with no public URL or custom domain.',
      );
    return {
      account: this.target.account,
      startedAt,
      completedAt: new Date().toISOString(),
      complete: true,
      scope,
      jurisdictions,
      buckets,
      metrics,
      metricsBytes: metricBytes(metrics),
      privateTarget: true,
      privacy: {
        managedEnabled: false,
        customDomains: [],
        storageClass: details.storage_class,
      },
      limitation:
        'Snapshot preflight plus explicit metadata reserve; no atomic reservation against unrelated account writers.',
    };
  }

  /** Stop unless both buckets are private: the archive's originals, and
   * what relatives send. Each must have its r2.dev URL off and no custom
   * domain. An answer that cannot be read, or that does not say so plainly,
   * stops too. Returns the archive bucket's settings. */
  async checkPrivate() {
    if (!SUBMISSIONS_BUCKET)
      throw new FamilyError(
        'flyleaf.json is missing cloudflare.submissions_bucket.',
      );
    const archive = await this.checkBucketPrivate(
      this.target.bucket,
      'archive bucket',
      'its files',
    );
    await this.checkBucketPrivate(
      SUBMISSIONS_BUCKET,
      'submissions bucket',
      'what relatives send',
    );
    return archive;
  }

  async checkBucketPrivate(bucket, label, contents) {
    const route = '/r2/buckets/' + bucket;
    let details, managed, custom;
    try {
      details = (await this.rest(route, this.target.jurisdiction)).result;
      managed = (
        await this.rest(route + '/domains/managed', this.target.jurisdiction)
      ).result;
      custom = (
        await this.rest(route + '/domains/custom', this.target.jurisdiction)
      ).result;
    } catch (error) {
      throw new Error(
        `Could not confirm that the ${label} ${bucket} is private ` +
          `(${error.message}). The Cloudflare token must be able to read the ` +
          "bucket's settings.",
      );
    }
    if (
      details?.name !== bucket ||
      details.jurisdiction !== this.target.jurisdiction ||
      typeof managed?.enabled !== 'boolean' ||
      !Array.isArray(custom?.domains)
    )
      throw new Error(
        `Could not confirm that the ${label} ${bucket} is private: ` +
          'Cloudflare gave an unexpected answer.',
      );
    if (managed.enabled || custom.domains.length)
      throw new Error(
        `The ${label} ${bucket} has a public address, so anyone could read ` +
          `${contents}. In Cloudflare, turn off its r2.dev URL and remove its ` +
          'custom domains, then deploy again.',
      );
    return { details, managedEnabled: false, customDomains: [] };
  }

  async head(key, signal) {
    try {
      const result = await retry(() =>
        send(
          this.client(),
          new HeadObjectCommand({ Bucket: this.target.bucket, Key: key }),
          signal,
        ),
      );
      return { bytes: result.ContentLength, etag: result.ETag };
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async get(key, etag, signal) {
    const result = await retry(() =>
      send(
        this.client(),
        new GetObjectCommand({
          Bucket: this.target.bucket,
          Key: key,
          IfMatch: etag,
        }),
        signal,
      ),
    );
    return { body: result.Body, etag: result.ETag };
  }

  async put(file, filename) {
    await retry(async () => {
      await withDeadline(async (signal) => {
        const body = createReadStream(filename);
        try {
          await this.client().send(
            new PutObjectCommand({
              Bucket: this.target.bucket,
              Key: file.key,
              Body: body,
              ContentLength: file.bytes,
              ContentMD5: file.md5,
              IfNoneMatch: '*',
              StorageClass: 'STANDARD',
              ContentType: contentType(file.key),
              CacheControl: 'private, no-store',
              Metadata: { sha256: file.sha256 },
            }),
            { abortSignal: signal },
          );
        } catch (error) {
          if (error.$metadata?.httpStatusCode === 412) return; // Caller must compare the bytes.
          if (transient(error) && (await this.head(file.key, signal))) return; // Ambiguous completed PUT: verify it.
          throw error;
        } finally {
          body.destroy();
        }
      });
    });
  }

  close() {
    for (const client of this.clients.values()) client.destroy();
  }
}
