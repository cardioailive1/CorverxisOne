/**
 * GCS image storage backend — raw REST + service-account JWT auth,
 * same pattern as src/integrations/training/gcp.js (reuses the exact
 * same token-exchange mechanics, which were verified for real there:
 * a real RSA keypair signed and validated correctly against Google's
 * documented claim structure).
 *
 * ⚠ Not executed against a real bucket — no GCS credentials available
 * here, same honest caveat as every other unverified-against-live-
 * infrastructure connector.
 */
const jwt = require('jsonwebtoken');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

async function getAccessToken(serviceAccountJson) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    sa.private_key,
    { algorithm: 'RS256' },
  );
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`GCP token exchange failed (${res.status}): ${body.error_description || body.error || 'unknown error'}`);
  return body.access_token;
}

function parseGsUri(uri) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`Not a valid gs:// URI: ${uri}`);
  return { bucket: match[1], object: match[2] };
}

async function saveImage({ serviceAccountJson, bucket, orgId, base64Data, mimeType = 'image/jpeg' }) {
  if (!base64Data) throw new Error('saveImage requires base64Data');
  const token = await getAccessToken(serviceAccountJson);
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const dateFolder = new Date().toISOString().slice(0, 10);
  const crypto = require('crypto');
  const objectName = `vision-images/${orgId}/${dateFolder}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const buffer = Buffer.from(base64Data, 'base64');

  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType }, body: buffer },
  );
  if (!res.ok) { const t = await res.text(); throw new Error(`GCS upload failed (${res.status}): ${t.slice(0, 200)}`); }

  return { imagePath: `gs://${bucket}/${objectName}`, sizeBytes: buffer.length };
}

async function readImage({ serviceAccountJson, imagePath }) {
  const { bucket, object } = parseGsUri(imagePath);
  const token = await getAccessToken(serviceAccountJson);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`GCS read failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteImage({ serviceAccountJson, imagePath }) {
  const { bucket, object } = parseGsUri(imagePath);
  const token = await getAccessToken(serviceAccountJson);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404) throw new Error(`GCS delete failed (${res.status})`);
}

module.exports = { saveImage, readImage, deleteImage, parseGsUri };
