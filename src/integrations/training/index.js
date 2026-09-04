/**
 * Training provider dispatcher — routes to the correct connector by
 * TrainingProviderType, and handles decrypting stored credentials
 * before every call so route handlers never touch raw credentials
 * directly.
 */
const { decryptCredentials } = require('./crypto');
const aws = require('./aws');
const gcp = require('./gcp');
const runpod = require('./runpod');

const CONNECTORS = { AWS_SAGEMAKER: aws, GCP_VERTEX_AI: gcp, RUNPOD: runpod };

function getConnector(providerType) {
  const connector = CONNECTORS[providerType];
  if (!connector) throw new Error(`Unknown training provider type: ${providerType}`);
  return connector;
}

// Normalizes each provider's differently-shaped stored credentials
// into the argument shape each connector function expects.
function buildCallArgs(providerRow, extra = {}) {
  const creds = decryptCredentials({
    ciphertext: providerRow.credentialsEncrypted,
    iv: providerRow.credentialsIv,
    tag: providerRow.credentialsTag,
  });
  const base = { region: providerRow.region, ...extra };
  if (providerRow.provider === 'AWS_SAGEMAKER') {
    return { ...base, accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, executionRoleArn: creds.executionRoleArn, s3Bucket: creds.s3Bucket };
  }
  if (providerRow.provider === 'GCP_VERTEX_AI') {
    return { ...base, serviceAccountJson: creds.serviceAccountJson, projectId: creds.projectId };
  }
  if (providerRow.provider === 'RUNPOD') {
    return { ...base, apiKey: creds.apiKey };
  }
  return base;
}

async function testProviderConnection(providerRow) {
  const connector = getConnector(providerRow.provider);
  return connector.testConnection(buildCallArgs(providerRow));
}

async function submitJob(providerRow, jobConfig) {
  const connector = getConnector(providerRow.provider);
  return connector.submitTrainingJob(buildCallArgs(providerRow, { jobConfig }));
}

async function pollJobStatus(providerRow, externalJobId) {
  const connector = getConnector(providerRow.provider);
  return connector.getJobStatus(buildCallArgs(providerRow, { externalJobId }));
}

async function stopJob(providerRow, externalJobId) {
  const connector = getConnector(providerRow.provider);
  return connector.stopJob(buildCallArgs(providerRow, { externalJobId }));
}

module.exports = { getConnector, testProviderConnection, submitJob, pollJobStatus, stopJob };
