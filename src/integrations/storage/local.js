/**
 * Local filesystem image storage — the default backend, and the only
 * one of the three storage backends that doesn't require any real
 * cloud account to actually use. Real for local dev, single-instance
 * deployments, or as a staging area before a real S3/GCS backend is
 * connected. Not durable across a Render redeploy (ephemeral disk),
 * which is exactly why S3/GCS exist as the other options — this one
 * is honest about that limitation, not presented as production-grade.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = process.env.LOCAL_IMAGE_STORAGE_PATH || path.join(__dirname, '..', '..', '..', 'uploads', 'vision-images');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Saves a base64-encoded image under a per-org, per-day directory
 * structure so a single directory never accumulates unboundedly many
 * files. Returns a path relative to UPLOAD_ROOT — the DB stores this
 * relative path, not an absolute filesystem path, so the storage
 * root can move without invalidating every existing reference.
 */
function saveImage({ orgId, base64Data, mimeType = 'image/jpeg' }) {
  if (!base64Data) throw new Error('saveImage requires base64Data');
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const dateFolder = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = path.join(UPLOAD_ROOT, orgId, dateFolder);
  ensureDir(dir);

  const filename = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const fullPath = path.join(dir, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(fullPath, buffer);

  const relativePath = path.join(orgId, dateFolder, filename);
  return { imagePath: relativePath, sizeBytes: buffer.length };
}

function getAbsolutePath(relativePath) {
  // Deliberately rejects any relativePath that escapes UPLOAD_ROOT via
  // ../ traversal — a stored imagePath should never be trusted to
  // stay within bounds without this check, since it ultimately
  // originates from ingest payloads sent by external gateway agents.
  const resolved = path.resolve(UPLOAD_ROOT, relativePath);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) {
    throw new Error('Invalid image path — resolves outside the upload root');
  }
  return resolved;
}

function readImage(relativePath) {
  const abs = getAbsolutePath(relativePath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${relativePath}`);
  return fs.readFileSync(abs);
}

function deleteImage(relativePath) {
  const abs = getAbsolutePath(relativePath);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

module.exports = { saveImage, readImage, deleteImage, getAbsolutePath, UPLOAD_ROOT };
