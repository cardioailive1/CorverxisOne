/**
 * Encrypts cloud training-provider credentials (AWS access keys, GCP
 * service account JSON, RunPod API keys) before they're written to
 * the database, and decrypts them when a job actually needs to be
 * submitted.
 *
 * Deliberately a SEPARATE key from payroll credentials
 * (TRAINING_CREDENTIALS_KEY, not PAYROLL_CREDENTIALS_KEY) — cloud GPU
 * account access and payroll provider access are unrelated trust
 * domains, and a leak of one key should never compromise the other.
 * Same AES-256-GCM construction as src/integrations/payroll/crypto.js.
 */
const crypto = require('crypto');

function getKey() {
  const raw = process.env.TRAINING_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error('TRAINING_CREDENTIALS_KEY is not set — cannot store or read training provider credentials securely.');
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encryptCredentials(obj) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

function decryptCredentials({ ciphertext, iv, tag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { encryptCredentials, decryptCredentials };
