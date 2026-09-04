/**
 * S3 image storage backend.
 *
 * ⚠ Not executed against a real bucket in this environment — no AWS
 * credentials available here, same honest caveat as the training
 * providers (src/integrations/training/aws.js). Uses the official AWS
 * SDK, same reasoning as that file: S3 request signing has the same
 * correctness risk as SageMaker's if hand-rolled.
 */
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

function makeClient({ accessKeyId, secretAccessKey, region }) {
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

async function saveImage({ accessKeyId, secretAccessKey, region, bucket, orgId, base64Data, mimeType = 'image/jpeg' }) {
  if (!base64Data) throw new Error('saveImage requires base64Data');
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const dateFolder = new Date().toISOString().slice(0, 10);
  const key = `vision-images/${orgId}/${dateFolder}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const buffer = Buffer.from(base64Data, 'base64');

  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType }));

  return { imagePath: `s3://${bucket}/${key}`, sizeBytes: buffer.length };
}

async function readImage({ accessKeyId, secretAccessKey, region, imagePath }) {
  const { bucket, key } = parseS3Uri(imagePath);
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function deleteImage({ accessKeyId, secretAccessKey, region, imagePath }) {
  const { bucket, key } = parseS3Uri(imagePath);
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function parseS3Uri(uri) {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`Not a valid s3:// URI: ${uri}`);
  return { bucket: match[1], key: match[2] };
}

module.exports = { saveImage, readImage, deleteImage, parseS3Uri };
