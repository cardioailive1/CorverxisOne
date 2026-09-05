/**
 * GCP Compute Engine raw GPU instance provisioning — same "own
 * orchestrator" principle as ec2.js, via raw Compute Engine instances
 * instead of Vertex AI's managed CustomJob API. Reuses the exact
 * service-account JWT auth mechanics already verified for real in
 * training/gcp.js and storage/gcs.js (a real RSA keypair was
 * generated and the signed assertion verified against Google's
 * documented claim structure).
 *
 * ⚠ Not executed against a real GCP project — no credentials
 * available here.
 */
const jwt = require('jsonwebtoken');
const { findGcpInstance } = require('./a100-catalog');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/compute';

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

function buildStartupScript({ apiBaseUrl, trainingJobId, dataSourceApiKey, modelType, baseModel, method, datasetUrl }) {
  // Same bootstrap logic as EC2's user-data, in GCE's "startup-script"
  // metadata key format — the mechanism differs per cloud, the actual
  // orchestration logic (pull training-scripts/, run entrypoint.py,
  // shut down when done) is identical.
  return `#!/bin/bash
set -e
exec > /var/log/corverxis-bootstrap.log 2>&1
echo "CorverxisONE training bootstrap starting at $(date)"

nvidia-smi || { echo "FATAL: GPU not visible to the instance"; exit 1; }

git clone --depth 1 https://github.com/corverxis/corverxis-platform.git /opt/corverxis || \\
  (echo "git clone failed — falling back to a pre-baked image assumption" && test -d /opt/corverxis)

cd /opt/corverxis/training-scripts
pip3 install --break-system-packages -r requirements.txt

export CORVERXIS_API_BASE_URL="${apiBaseUrl}"
export CORVERXIS_TRAINING_JOB_ID="${trainingJobId}"
export CORVERXIS_API_KEY="${dataSourceApiKey || ''}"
export MODEL_TYPE="${modelType}"
export BASE_MODEL="${baseModel || ''}"
export METHOD="${method || ''}"
export DATASET_LOCAL_PATH="/tmp/dataset"

${datasetUrl ? `curl -fSL "${datasetUrl}" -o /tmp/dataset` : 'echo "No dataset URL provided — training script must handle this itself"'}

python3 entrypoint.py

# GCE-specific: a Compute Engine instance calling its own shutdown
# only STOPS it (billing for the persistent disk continues, but not
# the compute) unless the instance was created with
# --no-restart-on-failure and the caller also explicitly deletes it —
# this platform's own poll loop (getInstanceStatus + the route
# handler) is responsible for the actual delete once it observes
# TERMINATED, not this script alone.
shutdown -h now
`;
}

async function testConnection({ serviceAccountJson, projectId, region }) {
  const token = await getAccessToken(serviceAccountJson);
  const zone = `${region}-a`;
  const res = await fetch(`https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances?maxResults=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`GCP Compute Engine auth check failed (${res.status}): ${t.slice(0, 200)}`); }
  return { ok: true, externalAccountId: projectId };
}

async function launchInstance({ serviceAccountJson, projectId, region, instanceType, jobConfig }) {
  const spec = findGcpInstance(instanceType); // throws clearly on a non-A100 type, same safety allowlist as EC2
  const token = await getAccessToken(serviceAccountJson);
  const zone = `${region}-a`;
  const instanceName = `corverxis-training-${jobConfig.trainingJobId}`.toLowerCase().slice(0, 63);

  const body = {
    name: instanceName,
    machineType: `zones/${zone}/machineTypes/${instanceType}`,
    guestAccelerators: [{ acceleratorType: `zones/${zone}/acceleratorTypes/nvidia-tesla-a100`, acceleratorCount: spec.gpuCount }],
    scheduling: { onHostMaintenance: 'TERMINATE', automaticRestart: false }, // required for any GPU-attached GCE instance
    disks: [{
      boot: true, autoDelete: true,
      initializeParams: { sourceImage: 'projects/ml-images/global/images/family/common-cu121-ubuntu-2204', diskSizeGb: '100' },
    }],
    networkInterfaces: [{ network: 'global/networks/default', accessConfigs: [{ type: 'ONE_TO_ONE_NAT', name: 'External NAT' }] }],
    metadata: { items: [{ key: 'startup-script', value: buildStartupScript(jobConfig) }] },
    tags: { items: ['corverxis-training'] },
    labels: { managedby: 'corverxisone', trainingjobid: jobConfig.trainingJobId.toLowerCase() },
  };

  const res = await fetch(`https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(`GCE instance launch failed (${res.status}): ${result.error?.message || 'unknown error'}`);

  return {
    externalInstanceId: instanceName,
    instanceType, gpuType: spec.gpuType, gpuCount: spec.gpuCount, costPerHourUsd: spec.costPerHourUsd,
    status: 'PROVISIONING',
  };
}

async function getInstanceStatus({ serviceAccountJson, projectId, region, externalInstanceId }) {
  const token = await getAccessToken(serviceAccountJson);
  const zone = `${region}-a`;
  const res = await fetch(`https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances/${externalInstanceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { status: res.status === 404 ? 'TERMINATED' : 'UNKNOWN' };
  const result = await res.json();
  // PROVISIONING, STAGING, RUNNING, STOPPING, TERMINATED — GCE's own vocabulary mapped onto this platform's
  const stateMap = { PROVISIONING: 'PROVISIONING', STAGING: 'PROVISIONING', RUNNING: 'RUNNING', STOPPING: 'TERMINATING', TERMINATED: 'TERMINATED' };
  return {
    status: stateMap[result.status] || 'UNKNOWN',
    publicIp: result.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
    privateIp: result.networkInterfaces?.[0]?.networkIP || null,
    raw: result,
  };
}

async function terminateInstance({ serviceAccountJson, projectId, region, externalInstanceId }) {
  const token = await getAccessToken(serviceAccountJson);
  const zone = `${region}-a`;
  const res = await fetch(`https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances/${externalInstanceId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`GCE instance delete failed (${res.status})`);
  return { ok: true };
}

module.exports = { testConnection, launchInstance, getInstanceStatus, terminateInstance, buildStartupScript };
