import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

export interface StoredObject { body: Buffer; etag: string }
export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  putImmutable(key: string, body: Uint8Array): Promise<{ etag: string }>;
  compareAndSwap(key: string, body: Uint8Array, expectedEtag: string | null): Promise<{ etag: string }>;
}
export class StorageConflictError extends Error {
  constructor() { super('Private storage changed concurrently; reload accepted state before retrying'); this.name = 'StorageConflictError'; }
}
export class StorageUnavailableError extends Error {
  constructor() { super('Private archive storage is unavailable; acquisition must stop'); this.name = 'StorageUnavailableError'; }
}
export function sha256(body: Uint8Array | string): string { return createHash('sha256').update(body).digest('hex'); }
export function jsonBytes(value: unknown): Buffer { return Buffer.from(JSON.stringify(value)); }
export function validateObjectKey(key: string): string {
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes(':') || key.split('/').some(p => !p || p === '.' || p === '..') || /[\u0000-\u001f]/.test(key))
    throw new Error('Invalid private object key');
  return key;
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Offline/local implementation. A per-key exclusive lock makes the compare + rename atomic
 * between processes. An abandoned lock fails closed; inspect it before removing it. */
export class LocalObjectStore implements ObjectStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private path(key: string): string {
    const path = resolve(this.root, validateObjectKey(key));
    if (!path.startsWith(this.root + sep)) throw new Error('Object path escapes private storage');
    return path;
  }
  async get(key: string): Promise<StoredObject | null> {
    const path = this.path(key);
    try { const body = await readFile(path); return { body, etag: sha256(body) }; }
    catch (error) { if (missing(error)) return null; throw new StorageUnavailableError(); }
  }
  private async write(key: string, body: Uint8Array, expectedEtag: string | null, immutable: boolean): Promise<{ etag: string }> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    let lock;
    try { lock = await open(`${path}.lock`, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageConflictError(); throw new StorageUnavailableError(); }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const existing = await this.get(key);
      if (immutable && existing) {
        if (!existing.body.equals(Buffer.from(body))) throw new StorageConflictError();
        return { etag: existing.etag };
      }
      if ((existing?.etag ?? null) !== expectedEtag) throw new StorageConflictError();
      const output = await open(temporary, 'wx', 0o600);
      try { await output.writeFile(body); await output.sync(); } finally { await output.close(); }
      await rename(temporary, path);
      return { etag: sha256(body) };
    } catch (error) {
      if (error instanceof StorageConflictError) throw error;
      throw new StorageUnavailableError();
    } finally {
      await lock.close();
      await unlink(`${path}.lock`);
      await unlink(temporary).catch(error => { if (!missing(error)) throw error; });
    }
  }
  putImmutable(key: string, body: Uint8Array) { return this.write(key, body, null, true); }
  compareAndSwap(key: string, body: Uint8Array, expectedEtag: string | null) { return this.write(key, body, expectedEtag, false); }
}

export interface S3ObjectStoreOptions {
  bucket: string; region: string; prefix?: string;
  credentials?: S3ClientConfig['credentials'];
  /** An explicit client makes the adapter testable without AWS or credentials. */
  client?: Pick<S3Client, 'send'>;
}
export class S3ObjectStore implements ObjectStore {
  private readonly client: Pick<S3Client, 'send'>;
  private readonly prefix: string;
  constructor(private readonly options: S3ObjectStoreOptions) {
    this.prefix = options.prefix ? `${validateObjectKey(options.prefix.replace(/\/$/, ''))}/` : '';
    this.client = options.client ?? new S3Client({ region: options.region, credentials: options.credentials });
  }
  private key(key: string) { return this.prefix + validateObjectKey(key); }
  async get(key: string): Promise<StoredObject | null> {
    const path = this.key(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: path }));
      if (!result.Body || !result.ETag) throw new StorageUnavailableError();
      return { body: Buffer.from(await result.Body.transformToByteArray()), etag: result.ETag };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 || (error as Error).name === 'NoSuchKey') return null;
      throw new StorageUnavailableError();
    }
  }
  private async write(key: string, body: Uint8Array, expectedEtag: string | null, immutable: boolean): Promise<{ etag: string }> {
    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: this.options.bucket, Key: this.key(key), Body: body,
        ...(expectedEtag === null ? { IfNoneMatch: '*' } : { IfMatch: expectedEtag }),
        ChecksumSHA256: Buffer.from(sha256(body), 'hex').toString('base64'),
        ServerSideEncryption: 'AES256', ContentType: key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      }));
      if (!result.ETag) throw new StorageUnavailableError();
      return { etag: result.ETag };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 409 || status === 412 || (status === 404 && expectedEtag !== null)) {
        if (immutable) {
          const existing = await this.get(key);
          if (existing?.body.equals(Buffer.from(body))) return { etag: existing.etag };
        }
        throw new StorageConflictError();
      }
      throw new StorageUnavailableError();
    }
  }
  putImmutable(key: string, body: Uint8Array) { return this.write(key, body, null, true); }
  compareAndSwap(key: string, body: Uint8Array, expectedEtag: string | null) { return this.write(key, body, expectedEtag, false); }
}
