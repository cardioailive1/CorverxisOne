/**
 * Image storage dispatcher. Defaults to local filesystem storage
 * (works with zero configuration) unless the org has a real S3/GCS
 * connection configured — reuses the SAME TrainingProvider-style
 * connection concept isn't quite right here since storage isn't a
 * "training provider," so this checks org-level env/config directly
 * rather than a DB-stored connection. A future iteration could give
 * storage its own connection model matching TrainingProvider's
 * pattern if multiple orgs need different S3/GCS buckets — today,
 * one bucket per deployment (set via env vars) is the honest,
 * simpler starting point.
 */
const local = require('./local');
const s3 = require('./s3');
const gcs = require('./gcs');

function getBackend() {
  if (process.env.IMAGE_STORAGE_BACKEND === 'S3') return 'S3';
  if (process.env.IMAGE_STORAGE_BACKEND === 'GCS') return 'GCS';
  return 'LOCAL';
}

async function saveImage({ orgId, base64Data, mimeType }) {
  const backend = getBackend();
  if (backend === 'S3') {
    const result = await s3.saveImage({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION, bucket: process.env.IMAGE_STORAGE_S3_BUCKET,
      orgId, base64Data, mimeType,
    });
    return { ...result, imageStorageType: 'S3' };
  }
  if (backend === 'GCS') {
    const result = await gcs.saveImage({
      serviceAccountJson: process.env.GCS_SERVICE_ACCOUNT_JSON, bucket: process.env.IMAGE_STORAGE_GCS_BUCKET,
      orgId, base64Data, mimeType,
    });
    return { ...result, imageStorageType: 'GCS' };
  }
  const result = local.saveImage({ orgId, base64Data, mimeType });
  return { ...result, imageStorageType: 'LOCAL' };
}

async function readImage({ imagePath, imageStorageType }) {
  if (imageStorageType === 'S3') {
    return s3.readImage({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, region: process.env.AWS_REGION, imagePath });
  }
  if (imageStorageType === 'GCS') {
    return gcs.readImage({ serviceAccountJson: process.env.GCS_SERVICE_ACCOUNT_JSON, imagePath });
  }
  return local.readImage(imagePath);
}

module.exports = { saveImage, readImage, getBackend };
