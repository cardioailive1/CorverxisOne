/**
 * Raw compute dispatcher — same pattern as training/index.js, but for
 * self-managed A100 instances (AWS_EC2_RAW / GCP_COMPUTE_RAW) instead
 * of managed training services.
 */
const { decryptCredentials } = require('../training/crypto');
const ec2 = require('./ec2');
const gce = require('./gce');

const CONNECTORS = { AWS_EC2_RAW: ec2, GCP_COMPUTE_RAW: gce };

function getConnector(providerType) {
  const connector = CONNECTORS[providerType];
  if (!connector) throw new Error(`Unknown raw compute provider type: ${providerType}`);
  return connector;
}

function buildCallArgs(providerRow, extra = {}) {
  const creds = decryptCredentials({ ciphertext: providerRow.credentialsEncrypted, iv: providerRow.credentialsIv, tag: providerRow.credentialsTag });
  const base = { region: providerRow.region, ...extra };
  if (providerRow.provider === 'AWS_EC2_RAW') {
    return { ...base, accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, keyPairName: creds.keyPairName, securityGroupId: creds.securityGroupId, subnetId: creds.subnetId };
  }
  if (providerRow.provider === 'GCP_COMPUTE_RAW') {
    return { ...base, serviceAccountJson: creds.serviceAccountJson, projectId: creds.projectId };
  }
  return base;
}

async function testProviderConnection(providerRow) {
  return getConnector(providerRow.provider).testConnection(buildCallArgs(providerRow));
}
async function launch(providerRow, instanceType, jobConfig) {
  return getConnector(providerRow.provider).launchInstance(buildCallArgs(providerRow, { instanceType, jobConfig }));
}
async function pollStatus(providerRow, externalInstanceId) {
  return getConnector(providerRow.provider).getInstanceStatus(buildCallArgs(providerRow, { externalInstanceId }));
}
async function terminate(providerRow, externalInstanceId) {
  return getConnector(providerRow.provider).terminateInstance(buildCallArgs(providerRow, { externalInstanceId }));
}

module.exports = { getConnector, testProviderConnection, launch, pollStatus, terminate };
