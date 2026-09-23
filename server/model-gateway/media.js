// Private media asset boundary. First version uses a controlled local object
// store adapter (MEDIA_STORAGE_DIR); object keys are namespaced by user.
// MediaRef is the canonical reference; the server never fetches arbitrary
// remote URLs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { PolicyError, MAX_REFERENCE_BYTES } from './policy.js';

const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

const storageRoot = () => process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'media-store');

const objectPath = (userId, objectKey) => {
  // objectKey is server-generated: user/<userId>/<uuid>; never trust client input.
  const safe = String(objectKey).replace(/[^a-zA-Z0-9/_-]/g, '');
  if (!safe.startsWith(`user/${userId}/`)) throw new PolicyError('FORBIDDEN', 'invalid object key', 403);
  return path.join(storageRoot(), safe);
};

export const assertMediaUpload = ({ sizeBytes, contentType, count }) => {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new PolicyError('UNSUPPORTED_MEDIA_TYPE', `unsupported content type: ${contentType}`, 422);
  }
  if (sizeBytes > MAX_REFERENCE_BYTES) {
    throw new PolicyError('PAYLOAD_TOO_LARGE', 'media exceeds 50 MiB', 413);
  }
  if (count > 16) {
    throw new PolicyError('PAYLOAD_TOO_LARGE', 'too many files per request', 413);
  }
};

export const uploadMedia = async ({ userId, buffer, contentType, checksumSha256 }) => {
  assertMediaUpload({ sizeBytes: buffer.length, contentType, count: 1 });
  const assetId = crypto.randomUUID();
  const objectKey = `user/${userId}/${assetId}`;
  await fs.mkdir(path.join(storageRoot(), 'user', userId), { recursive: true });
  await fs.writeFile(objectPath(userId, objectKey), buffer);
  const { rows } = await pool.query(
    `INSERT INTO media_assets (id, user_id, object_key, content_type, size_bytes, checksum_sha256, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ready')
     RETURNING id, content_type, size_bytes`,
    [assetId, userId, objectKey, contentType, buffer.length, checksumSha256]
  );
  const row = rows[0];
  return { ...row, size_bytes: Number(row.size_bytes) };
};

export const getMediaRecord = async (userId, assetId) => {
  const { rows } = await pool.query(
    `SELECT id, object_key, content_type, size_bytes, status FROM media_assets
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [assetId, userId]
  );
  return rows[0] ?? null;
};

export const getMediaContent = async (userId, assetId) => {
  const record = await getMediaRecord(userId, assetId);
  if (!record || record.status !== 'ready') {
    throw new PolicyError('NOT_FOUND', 'media not found', 404);
  }
  const buffer = await fs.readFile(objectPath(userId, record.object_key));
  return { buffer, contentType: record.content_type, sizeBytes: record.size_bytes };
};

// Soft delete; physical cleanup happens when ref_count reaches 0.
export const deleteMedia = async (userId, assetId) => {
  const record = await getMediaRecord(userId, assetId);
  if (!record) return false;
  await pool.query(
    `UPDATE media_assets SET status = 'deleted', deleted_at = NOW() WHERE id = $1 AND user_id = $2`,
    [assetId, userId]
  );
  return true;
};

export const incrementRefCount = async (assetId) => {
  await pool.query('UPDATE media_assets SET ref_count = ref_count + 1 WHERE id = $1', [assetId]);
};

// Convert a Data URL / legacy local reference into a stored MediaRef.
export const ensureMediaRef = async ({ userId, dataUrl }) => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) throw new PolicyError('INVALID_PARAMS', 'only data URLs are accepted as media input', 422);
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const record = await uploadMedia({ userId, buffer, contentType, checksumSha256: checksum });
  return { kind: 'media', id: record.id, contentType: record.content_type, sizeBytes: record.size_bytes };
};

export const toMediaRef = (record) => ({
  kind: 'media',
  id: record.id,
  contentType: record.content_type,
  sizeBytes: record.size_bytes,
});
