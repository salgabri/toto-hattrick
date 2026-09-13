import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { LocalObjectStore, S3ObjectStore, StorageConflictError, StorageUnavailableError } from './storage.js';

test('immutable writes are idempotent; a stale pointer cannot overwrite newer progress', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(root);
  const first = await store.putImmutable('evidence/test.json', Buffer.from('original'));
  assert.deepEqual(await store.putImmutable('evidence/test.json', Buffer.from('original')), first);
  await assert.rejects(store.putImmutable('evidence/test.json', Buffer.from('changed')), StorageConflictError);
  const initial = await store.compareAndSwap('state/current.json', Buffer.from('first'), null);
  const attempts = await Promise.allSettled([
    store.compareAndSwap('state/current.json', Buffer.from('second'), initial.etag),
    store.compareAndSwap('state/current.json', Buffer.from('third'), initial.etag),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(store.compareAndSwap('state/current.json', Buffer.from('stale'), initial.etag), StorageConflictError);
  assert.notEqual((await store.get('state/current.json'))!.body.toString(), 'stale');
  await assert.rejects(store.get('../outside'), /Invalid private object key/);
});

test('S3 requests enforce creation/CAS preconditions, encryption, and payload checksums', async () => {
  const inputs: unknown[] = [];
  const client = { send: async (command: GetObjectCommand | PutObjectCommand) => {
    inputs.push(command.input);
    return command instanceof GetObjectCommand ? { ETag: 'version-one', Body: { transformToByteArray: async () => Buffer.from('stored') } } : { ETag: 'version-two' };
  } } as unknown as Pick<S3Client, 'send'>;
  const store = new S3ObjectStore({ bucket: 'private-archive', region: 'eu-central-1', prefix: 'production', client });
  assert.equal((await store.get('state/current.json'))?.body.toString(), 'stored');
  await store.putImmutable('evidence/capture.json', Buffer.from('capture'));
  await store.compareAndSwap('state/current.json', Buffer.from('next'), 'version-one');
  const immutable = inputs[1] as Record<string, unknown>;
  assert.equal(immutable.Key, 'production/evidence/capture.json');
  assert.equal(immutable.IfNoneMatch, '*');
  assert.equal(immutable.ServerSideEncryption, 'AES256');
  assert.ok(immutable.ChecksumSHA256);
  assert.equal((inputs[2] as Record<string, unknown>).IfMatch, 'version-one');
});

test('S3 conflicts and storage failures do not look like missing objects', async () => {
  const conflictClient = { send: async () => { throw { $metadata: { httpStatusCode: 412 } }; } } as unknown as Pick<S3Client, 'send'>;
  const conflict = new S3ObjectStore({ bucket: 'private', region: 'eu-central-1', client: conflictClient });
  await assert.rejects(conflict.compareAndSwap('state/current.json', Buffer.from('bad'), 'old'), StorageConflictError);
  const deniedClient = { send: async () => { throw { $metadata: { httpStatusCode: 403 } }; } } as unknown as Pick<S3Client, 'send'>;
  await assert.rejects(new S3ObjectStore({ bucket: 'private', region: 'eu-central-1', client: deniedClient }).get('state/current.json'), StorageUnavailableError);
});
