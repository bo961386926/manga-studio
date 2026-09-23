import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureMigrated, resetIdentityTables, insertUser, pool } from './helpers.js';
import {
  uploadMedia,
  getMediaContent,
  getMediaRecord,
  deleteMedia,
  ensureMediaRef,
  assertMediaUpload,
} from '../model-gateway/media.js';
import { PolicyError } from '../model-gateway/policy.js';

let tmpDir;
let u1;
let u2;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-test-'));
  process.env.MEDIA_STORAGE_DIR = tmpDir;
  await ensureMigrated();
  await resetIdentityTables();
  u1 = await insertUser({ email: 'm1@example.com' });
  u2 = await insertUser({ email: 'm2@example.com' });
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await pool.end();
});

test('media upload stores a ready asset with checksum', async () => {
  const buffer = Buffer.from('png-bytes');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const record = await uploadMedia({ userId: u1, buffer, contentType: 'image/png', checksumSha256: checksum });
  assert.equal(record.content_type, 'image/png');
  assert.equal(record.size_bytes, buffer.length);
  assert.ok(record.id);
});

test('media content requires owner and enforces size/type quota', async () => {
  const buffer = Buffer.from('hello-media');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const { id } = await uploadMedia({ userId: u1, buffer, contentType: 'image/png', checksumSha256: checksum });

  const mine = await getMediaContent(u1, id);
  assert.equal(mine.buffer.toString('utf8'), 'hello-media');
  assert.equal(mine.contentType, 'image/png');

  // Other user gets 404 (no existence leak).
  await assert.rejects(getMediaContent(u2, id), (e) => e instanceof PolicyError && e.status === 404);
  // Unknown id also 404.
  await assert.rejects(getMediaContent(u1, crypto.randomUUID()), (e) => e.status === 404);

  // Size quota.
  await assert.rejects(
    uploadMedia({ userId: u1, buffer: Buffer.alloc(50 * 1024 * 1024 + 1), contentType: 'image/png', checksumSha256: 'a'.repeat(64) }),
    (e) => e.code === 'PAYLOAD_TOO_LARGE'
  );
  // Unsupported MIME.
  assert.throws(() => assertMediaUpload({ sizeBytes: 10, contentType: 'text/html', count: 1 }), PolicyError);
});

test('soft delete hides content from owner and others', async () => {
  const buffer = Buffer.from('to-delete');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const { id } = await uploadMedia({ userId: u1, buffer, contentType: 'image/png', checksumSha256: checksum });
  assert.equal(await deleteMedia(u1, id), true);
  await assert.rejects(getMediaContent(u1, id), (e) => e.status === 404);
  // Deleting someone else's asset is a no-op (404 semantics).
  assert.equal(await deleteMedia(u2, id), false);
});

test('ensureMediaRef converts data URLs only', async () => {
  const dataUrl = `data:image/png;base64,${Buffer.from('ref-data').toString('base64')}`;
  const ref = await ensureMediaRef({ userId: u1, dataUrl });
  assert.equal(ref.kind, 'media');
  assert.equal(ref.contentType, 'image/png');
  const content = await getMediaContent(u1, ref.id);
  assert.equal(content.buffer.toString('utf8'), 'ref-data');

  await assert.rejects(ensureMediaRef({ userId: u1, dataUrl: 'https://evil.example/x.png' }), /data URLs/);
  await assert.rejects(ensureMediaRef({ userId: u1, dataUrl: '' }), PolicyError);
});
