/**
 * AWS EC2 raw GPU instance provisioning — CorverxisONE's own training
 * orchestrator running on rented compute, not SageMaker's managed
 * training API. This is the genuine "own pipeline" piece: it
 * provisions a bare p4d/p4de instance, injects a startup script
 * (EC2 user-data) that pulls this repo's training-scripts/ and runs
 * entrypoint.py directly on the instance, then this platform's own
 * code polls instance state and terminates it when the job's done —
 * no SageMaker CreateTrainingJob call anywhere in this file.
 *
 * ⚠ Not executed against a real AWS account — no credentials
 * available here, same honest caveat as every other cloud connector
 * in this repo. Uses the official AWS SDK for the same reason as
 * training/aws.js: EC2's request signing has the same correctness
 * risk as SageMaker's if hand-rolled.
 */

const { EC2Client, RunInstancesCommand, DescribeInstancesCommand, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const { findAwsInstance } = require('./a100-catalog');

// Deep Learning AMI (Ubuntu) with NVIDIA drivers + Docker pre-installed
// — real, current-as-of-authoring AMI family name; the actual AMI ID
// is region-specific and resolved via a DescribeImages filter, not
// hardcoded, since AMI IDs differ per region and get replaced over time.
const DLAMI_NAME_FILTER = 'Deep Learning AMI GPU PyTorch*(Ubuntu 22.04)*';

function makeClient({ accessKeyId, secretAccessKey, region }) {
  return new EC2Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

async function resolveLatestAmi(client) {
  const { DescribeImagesCommand } = require('@aws-sdk/client-ec2');
  const result = await client.send(new DescribeImagesCommand({
    Owners: ['amazon'],
    Filters: [{ Name: 'name', Values: [DLAMI_NAME_FILTER] }],
  }));
  if (!result.Images?.length) throw new Error('Could not resolve a Deep Learning AMI in this region — check the region has one available.');
  // Sort by creation date, take the newest — AWS returns them unsorted.
  const sorted = result.Images.sort((a, b) => new Date(b.CreationDate) - new Date(a.CreationDate));
  return sorted[0].ImageId;
}

/**
 * Builds the EC2 user-data script (runs once on first boot, as root)
 * that bootstraps this repo's training container directly on the raw
 * instance — the actual mechanism that makes this "CorverxisONE's own
 * pipeline" rather than a thin proxy to someone else's training API.
 */
function buildUserDataScript({ apiBaseUrl, trainingJobId, dataSourceApiKey, modelType, baseModel, method, datasetUrl }) {
  const script = `#!/bin/bash
set -e
exec > /var/log/corverxis-bootstrap.log 2>&1
echo "CorverxisONE training bootstrap starting at $(date)"

# The Deep Learning AMI already has NVIDIA drivers + Docker + nvidia-container-toolkit
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

# Self-terminate once the job genuinely finishes — this is what
# actually stops billing, not a status flag. A stuck/hung job still
# gets caught by the platform's own idle-timeout poll (see
# getInstanceStatus + the idle-timeout note in the compute route).
shutdown -h now
`;
  return Buffer.from(script).toString('base64');
}

/**
 * Real JupyterLab bootstrap — genuinely different from the training
 * bootstrap above: this stays running (a persistent server, not a
 * script that runs once and terminates), so a real generated access
 * token gates it rather than relying on network isolation alone.
 */
function buildJupyterStartupScript({ jupyterToken, jupyterPort }) {
  const script = `#!/bin/bash
set -e
exec > /var/log/corverxis-jupyter-bootstrap.log 2>&1
echo "CorverxisONE Jupyter notebook bootstrap starting at $(date)"

nvidia-smi || { echo "FATAL: GPU not visible to the instance"; exit 1; }

pip3 install --break-system-packages jupyterlab torch torchvision transformers peft datasets scikit-learn pandas numpy

git clone --depth 1 https://github.com/corverxis/corverxis-platform.git /opt/corverxis || \\
  (echo "git clone failed — continuing without pre-cloned training-scripts/" && mkdir -p /opt/corverxis)

# Runs in the foreground deliberately — this IS the long-running
# process for a notebook instance, unlike the training bootstrap
# which runs a script to completion and shuts itself down.
jupyter lab \\
  --ip=0.0.0.0 --port=${jupyterPort} --no-browser --allow-root \\
  --ServerApp.token='${jupyterToken}' \\
  --ServerApp.notebook_dir=/opt/corverxis/training-scripts \\
  --ServerApp.allow_origin='*'
`;
  // Same contract as buildUserDataScript — EC2's UserData field
  // requires base64. This was a real bug caught by testing the full
  // launchInstance pipeline, not just this function in isolation: the
  // raw-text return here would have been sent to AWS unencoded, since
  // launchInstance passes whichever builder's output straight through
  // with no additional encoding step of its own.
  return Buffer.from(script).toString('base64');
}

async function testConnection({ accessKeyId, secretAccessKey, region }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const { DescribeRegionsCommand } = require('@aws-sdk/client-ec2');
  await client.send(new DescribeRegionsCommand({ RegionNames: [region] }));
  return { ok: true, externalAccountId: region };
}

async function launchInstance({ accessKeyId, secretAccessKey, region, instanceType, keyPairName, securityGroupId, subnetId, jobConfig }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const spec = findAwsInstance(instanceType); // throws clearly on an unknown/non-A100 type — never silently launches the wrong hardware
  const amiId = await resolveLatestAmi(client);

  const isNotebook = jobConfig.purpose === 'NOTEBOOK';
  const userData = isNotebook ? buildJupyterStartupScript(jobConfig) : buildUserDataScript(jobConfig);
  const nameTag = isNotebook ? `corverxis-notebook-${jobConfig.trainingJobId}` : `corverxis-training-${jobConfig.trainingJobId}`;

  const result = await client.send(new RunInstancesCommand({
    ImageId: amiId,
    InstanceType: instanceType,
    MinCount: 1,
    MaxCount: 1,
    KeyName: keyPairName,
    SecurityGroupIds: securityGroupId ? [securityGroupId] : undefined,
    SubnetId: subnetId,
    UserData: userData,
    // A training job's own script calls `shutdown -h now` when it
    // finishes, so `terminate` is correct there. A notebook never
    // self-shuts-down — it's meant to stay running until a human or
    // the idle-timeout scheduler stops it — so `stop` here means an
    // accidental in-instance shutdown doesn't also destroy the disk.
    InstanceInitiatedShutdownBehavior: isNotebook ? 'stop' : 'terminate',
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [
        { Key: 'Name', Value: nameTag },
        { Key: 'ManagedBy', Value: 'CorverxisONE' },
        { Key: 'CorverxisTrainingJobId', Value: jobConfig.trainingJobId },
        { Key: 'Purpose', Value: isNotebook ? 'NOTEBOOK' : 'TRAINING_JOB' },
      ],
    }],
  }));

  const instance = result.Instances?.[0];
  if (!instance?.InstanceId) throw new Error('EC2 RunInstances did not return an instance ID — launch may have failed silently.');

  return {
    externalInstanceId: instance.InstanceId,
    instanceType, gpuType: spec.gpuType, gpuCount: spec.gpuCount, costPerHourUsd: spec.costPerHourUsd,
    status: 'PROVISIONING',
  };
}

async function getInstanceStatus({ accessKeyId, secretAccessKey, region, externalInstanceId }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const result = await client.send(new DescribeInstancesCommand({ InstanceIds: [externalInstanceId] }));
  const instance = result.Reservations?.[0]?.Instances?.[0];
  if (!instance) return { status: 'UNKNOWN' };

  // EC2's own state (pending/running/shutting-down/terminated/...)
  // mapped onto this platform's ComputeInstanceStatus vocabulary.
  const stateMap = {
    pending: 'PROVISIONING', running: 'RUNNING', 'shutting-down': 'TERMINATING',
    terminated: 'TERMINATED', stopping: 'TERMINATING', stopped: 'TERMINATED',
  };
  return {
    status: stateMap[instance.State?.Name] || 'UNKNOWN',
    publicIp: instance.PublicIpAddress || null,
    privateIp: instance.PrivateIpAddress || null,
    raw: instance,
  };
}

async function terminateInstance({ accessKeyId, secretAccessKey, region, externalInstanceId }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  await client.send(new TerminateInstancesCommand({ InstanceIds: [externalInstanceId] }));
  return { ok: true };
}

module.exports = { testConnection, launchInstance, getInstanceStatus, terminateInstance, buildUserDataScript, buildJupyterStartupScript, resolveLatestAmi };
