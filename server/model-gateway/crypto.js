// Model gateway credential/result AEAD. AES-256-GCM with 96-bit CSPRNG nonce;
// AAD binds owner, record, field, table and key id. Unknown key ids and tag
// failures fail closed. Deployment key from MODEL_ENC_KEY (32-byte hex);
// development falls back to a fixed derivation — never use it in production.
import crypto from 'node:crypto';

const DEFAULT_KEY_ID = process.env.MODEL_ENC_KEY_ID || 'v1';

const deploymentKey = () =>
  crypto.createHash('sha256').update(process.env.MODEL_ENC_KEY || 'dev-only-model-enc-key').digest();

export const sealSecret = (secret, { ownerId, recordId, field, keyId = DEFAULT_KEY_ID }) => {
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`table:model_gateway|owner:${ownerId}|record:${recordId}|field:${field}|key:${keyId}`);
  const cipher = crypto.createCipheriv('aes-256-gcm', deploymentKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag, keyId };
};

export const openSecret = (sealed, { ownerId, recordId, field, keyId }) => {
  if (!sealed || sealed.keyId !== keyId) {
    throw new Error('unknown key id');
  }
  const aad = Buffer.from(`table:model_gateway|owner:${ownerId}|record:${recordId}|field:${field}|key:${keyId}`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deploymentKey(), sealed.iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  const plaintext = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};

// Request hashes use a deployment-secret HMAC (never bare SHA-256 of prompts).
export const requestHash = (canonicalJson) =>
  crypto
    .createHmac('sha256', process.env.REQUEST_HMAC_KEY || 'dev-request-hmac-key')
    .update(canonicalJson)
    .digest('hex');
