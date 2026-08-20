// Password hashing and policy primitives.
// Argon2id via the argon2 package; never plain SHA-256 for stored passwords.
import argon2 from 'argon2';

export const PASSWORD_MIN_BYTES = 10;
export const PASSWORD_MAX_BYTES = 128;

// Trim surrounding whitespace and lowercase the domain part only.
// The local part stays case-sensitive per RFC 5321 but the identity key in
// this system is the normalized lowercase whole address.
export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  const trimmed = email.trim().toLowerCase();
  return trimmed;
}

// Enforce the documented byte-length password policy.
export function validatePassword(password) {
  if (typeof password !== 'string') return false;
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes >= PASSWORD_MIN_BYTES && bytes <= PASSWORD_MAX_BYTES;
}

export async function hashPassword(password) {
  if (!validatePassword(password)) {
    throw new Error('password does not meet policy');
  }
  // Default Argon2id parameters (argon2 package defaults: m=65536, t=3, p=4).
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash, password) {
  return argon2.verify(hash, password);
}
