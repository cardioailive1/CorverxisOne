/**
 * GCP Vertex AI connector
 * ─────────────────────────────────────────────────────────────
 * Docs: https://cloud.google.com/vertex-ai/docs/training/create-custom-job
 * Auth: Service account JSON key, exchanged for a short-lived OAuth2
 *       access token via a self-signed JWT (the standard Google
 *       server-to-server auth flow — no full google-auth-library
 *       dependency needed since the platform already has
 *       `jsonwebtoken` for its own session handling).
 */

const jwt = require('jsonwebtoken');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

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
  if (!res.ok || !body.access_token) {
    throw new Error(`GCP token exchange failed (${res.status}): ${body.error_description || body.error || 'unknown error'}`);
  }
  return body.access_token;
}

async function testConnection({ serviceAccountJson, projectId, region }) {
  const token = await getAccessToken(serviceAccountJson);
  const res = await fetch(
    `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/customJobs?pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GCP Vertex AI auth check failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return { ok: true, externalAccountId: projectId };
}

// GPU tier → Vertex AI machine/accelerator config
const GPU_TIER_MAP = {
  'Flash — Single GPU': { machineType: 'n1-standard-8', acceleratorType: 'NVIDIA_TESLA_T4', acceleratorCount: 1 },
  'Pro — H100 80GB': { machineType: 'a3-highgpu-1g', acceleratorType: 'NVIDIA_H100_80GB', acceleratorCount: 1 },
  'Ultra — 8× H100': { machineType: 'a3-highgpu-8g', acceleratorType: 'NVIDIA_H100_80GB', acceleratorCount: 8 },
};

async function submitTrainingJob({ serviceAccountJson, projectId, region, jobConfig }) {
  const token = await getAccessToken(serviceAccountJson);
  const machine = GPU_TIER_MAP[jobConfig.gpuTier] || GPU_TIER_MAP['Flash — Single GPU'];

  const body = {
    displayName: `corverxis-${jobConfig.trainingJobId}`,
    jobSpec: {
      workerPoolSpecs: [{
        machineSpec: { machineType: machine.machineType, acceleratorType: machine.acceleratorType, acceleratorCount: machine.acceleratorCount },
        replicaCount: 1,
        containerSpec: {
          imageUri: jobConfig.containerImage || 'gcr.io/corverxis/training:latest',
          args: [
            `--model-type=${jobConfig.modelType}`,
            `--base-model=${jobConfig.baseModel || ''}`,
            `--method=${jobConfig.method || ''}`,
            `--dataset-url=${jobConfig.datasetUrl || ''}`,
          ],
          env: [
            { name: 'CORVERXIS_API_BASE_URL', value: jobConfig.apiBaseUrl },
            { name: 'CORVERXIS_TRAINING_JOB_ID', value: jobConfig.trainingJobId },
            { name: 'CORVERXIS_API_KEY', value: jobConfig.dataSourceApiKey },
          ],
        },
      }],
    },
  };

  const res = await fetch(
    `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/customJobs`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const result = await res.json();
  if (!res.ok) throw new Error(`GCP Vertex AI job submission failed (${res.status}): ${result.error?.message || 'unknown error'}`);

  return {
    externalJobId: result.name, // full resource name, e.g. projects/.../customJobs/1234
    providerLogsUrl: `https://console.cloud.google.com/vertex-ai/training/custom-jobs/${result.name?.split('/').pop()}?project=${projectId}`,
    status: 'QUEUED',
  };
}

async function getJobStatus({ serviceAccountJson, externalJobId }) {
  const token = await getAccessToken(serviceAccountJson);
  const res = await fetch(`https://${externalJobId.split('/')[3]}-aiplatform.googleapis.com/v1/${externalJobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await res.json();
  if (!res.ok) return { status: 'UNKNOWN' };
  // JOB_STATE_QUEUED, JOB_STATE_RUNNING, JOB_STATE_SUCCEEDED, JOB_STATE_FAILED, JOB_STATE_CANCELLED
  const statusMap = {
    JOB_STATE_QUEUED: 'QUEUED', JOB_STATE_PENDING: 'QUEUED', JOB_STATE_RUNNING: 'RUNNING',
    JOB_STATE_SUCCEEDED: 'COMPLETED', JOB_STATE_FAILED: 'FAILED', JOB_STATE_CANCELLED: 'FAILED',
  };
  return { status: statusMap[result.state] || 'RUNNING', raw: result };
}

async function stopJob({ serviceAccountJson, externalJobId }) {
  const token = await getAccessToken(serviceAccountJson);
  const res = await fetch(`https://${externalJobId.split('/')[3]}-aiplatform.googleapis.com/v1/${externalJobId}:cancel`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GCP job cancel failed (${res.status})`);
  return { ok: true };
}

module.exports = { testConnection, submitTrainingJob, getJobStatus, stopJob };
