/**
 * RunPod connector
 * ─────────────────────────────────────────────────────────────
 * Docs: https://docs.runpod.io/api-reference
 * Auth: Bearer API key, generated in the RunPod console.
 *
 * RunPod's model is renting a GPU pod for the duration of a job,
 * not a managed "submit training job" API the way SageMaker/Vertex
 * AI are — this connector provisions a pod running the platform's
 * training container, passes the job config as environment
 * variables, and the container itself runs the actual training
 * script (see /training-scripts in the repo root) and reports
 * progress back to CorverxisLab via the existing ingest pattern.
 */

const BASE_URL = 'https://api.runpod.io/graphql';

async function gqlRequest(apiKey, query, variables) {
  const res = await fetch(`${BASE_URL}?api_key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    const msg = body.errors ? body.errors.map(e => e.message).join('; ') : res.statusText;
    throw new Error(`RunPod API error (${res.status}): ${msg}`);
  }
  return body.data;
}

async function testConnection({ apiKey }) {
  const data = await gqlRequest(apiKey, `query { myself { id email } }`);
  if (!data?.myself?.id) throw new Error('RunPod auth check succeeded but returned no account info.');
  return { ok: true, externalAccountId: data.myself.id };
}

// GPU type IDs are RunPod's own catalog identifiers — these are the
// common ones as of the platform's GPU tier naming; RunPod's catalog
// can change, so this is a starting map, not guaranteed exhaustive.
const GPU_TIER_MAP = {
  'Flash — Single GPU': 'NVIDIA RTX A4000',
  'Pro — H100 80GB': 'NVIDIA H100 80GB HBM3',
  'Ultra — 8× H100': 'NVIDIA H100 80GB HBM3', // pod count handled separately, RunPod pods are single-GPU-type each
};

async function submitTrainingJob({ apiKey, jobConfig }) {
  const gpuTypeId = GPU_TIER_MAP[jobConfig.gpuTier] || 'NVIDIA RTX A4000';
  const mutation = `
    mutation podFindAndDeployOnDemand($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        imageName
        machineId
        desiredStatus
      }
    }
  `;
  const variables = {
    input: {
      cloudType: 'SECURE',
      gpuTypeId,
      gpuCount: jobConfig.gpuTier === 'Ultra — 8× H100' ? 8 : 1,
      name: `corverxis-${jobConfig.trainingJobId}`,
      imageName: jobConfig.containerImage || 'corverxis/training:latest',
      dockerArgs: '',
      env: [
        { key: 'CORVERXIS_API_BASE_URL', value: jobConfig.apiBaseUrl },
        { key: 'CORVERXIS_TRAINING_JOB_ID', value: jobConfig.trainingJobId },
        { key: 'CORVERXIS_API_KEY', value: jobConfig.dataSourceApiKey },
        { key: 'MODEL_TYPE', value: jobConfig.modelType },
        { key: 'BASE_MODEL', value: jobConfig.baseModel || '' },
        { key: 'METHOD', value: jobConfig.method || '' },
        { key: 'DATASET_URL', value: jobConfig.datasetUrl || '' },
      ],
      volumeInGb: 50,
      containerDiskInGb: 20,
    },
  };
  const data = await gqlRequest(apiKey, mutation, variables);
  const pod = data?.podFindAndDeployOnDemand;
  if (!pod?.id) throw new Error('RunPod did not return a pod ID — deployment may have failed silently.');
  return {
    externalJobId: pod.id,
    providerLogsUrl: `https://www.runpod.io/console/pods/${pod.id}`,
    status: pod.desiredStatus || 'PENDING',
  };
}

async function getJobStatus({ apiKey, externalJobId }) {
  const data = await gqlRequest(apiKey, `
    query pod($input: PodFilter!) {
      pod(input: $input) { id desiredStatus runtime { uptimeInSeconds } }
    }
  `, { input: { podId: externalJobId } });
  const pod = data?.pod;
  if (!pod) return { status: 'UNKNOWN' };
  // RunPod's own status vocabulary maps onto the platform's simpler
  // QUEUED / RUNNING / COMPLETED / FAILED states.
  const statusMap = { CREATED: 'QUEUED', RUNNING: 'RUNNING', EXITED: 'COMPLETED', TERMINATED: 'FAILED' };
  return { status: statusMap[pod.desiredStatus] || 'RUNNING', raw: pod };
}

async function stopJob({ apiKey, externalJobId }) {
  await gqlRequest(apiKey, `
    mutation podTerminate($input: PodTerminateInput!) { podTerminate(input: $input) }
  `, { input: { podId: externalJobId } });
  return { ok: true };
}

module.exports = { testConnection, submitTrainingJob, getJobStatus, stopJob };
