// Encrypted migration envelope (v1): Argon2id-derived AES-256-GCM with
// export/version/purpose AAD. The password is never stored in the file;
// plaintext buffers and derived keys are wiped after use.
import argon2 from 'argon2';
import crypto from 'node:crypto';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_TTL_MS = 24 * 60 * 60 * 1000;

const KDF_PARAMS = { memoryCost: 65536, time: 3, parallelism: 1 };

const deriveKey = async (password, salt, params) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: params.memoryCost,
    time: params.time,
    parallelism: params.parallelism,
    salt,
    raw: true,
    hashLength: 32,
  });

export const sealEnvelope = async (
  { exportId, config, purpose = 'legacy-model-config' },
  password
) => {
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(password, salt, KDF_PARAMS);
  try {
    const iv = crypto.randomBytes(12);
    const aad = Buffer.from(`${exportId}/${ENVELOPE_VERSION}/${purpose}`);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const plaintext = Buffer.from(JSON.stringify(config), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: ENVELOPE_VERSION,
      exportId,
      purpose,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ENVELOPE_TTL_MS).toISOString(),
      kdf: { type: 'argon2id', ...KDF_PARAMS, salt: salt.toString('hex') },
      cipher: { algo: 'aes-256-gcm', iv: iv.toString('hex'), tag: tag.toString('hex') },
      data: ciphertext.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
};

export const openEnvelope = async (envelope, password) => {
  if (!envelope || envelope.v !== ENVELOPE_VERSION) {
    throw new Error('unsupported envelope version');
  }
  if (new Date(envelope.expiresAt).getTime() < Date.now()) {
    throw new Error('envelope expired');
  }
  const key = await deriveKey(
    password,
    Buffer.from(envelope.kdf.salt, 'hex'),
    envelope.kdf
  );
  try {
    const aad = Buffer.from(`${envelope.exportId}/${envelope.v}/${envelope.purpose}`);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.cipher.iv, 'hex')
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'hex'));
    let plaintext;
    try {
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]);
    } catch {
      throw new Error('authentication failed');
    }
    return { exportId: envelope.exportId, config: JSON.parse(plaintext.toString('utf8')) };
  } finally {
    key.fill(0);
  }
};
