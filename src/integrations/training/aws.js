/**
 * AWS SageMaker connector
 * ─────────────────────────────────────────────────────────────
 * Docs: https://docs.aws.amazon.com/sagemaker/latest/APIReference/
 * Auth: IAM access key + secret (or an assumed role) with
 *       sagemaker:CreateTrainingJob / DescribeTrainingJob /
 *       StopTrainingJob permissions, plus an execution role ARN
 *       SageMaker itself assumes to pull the training container
 *       and read/write S3.
 *
 * Unlike RunPod (raw GraphQL) and GCP (raw REST + hand-signed JWT),
 * this uses the official AWS SDK v3 rather than hand-rolled requests
 * — SigV4 request signing is genuinely easy to get subtly wrong by
 * hand, and a signing bug would silently fail every single call.
 * Correctness here matters more than dependency-footprint
 * consistency with the other two connectors.
 */

const { SageMakerClient, CreateTrainingJobCommand, DescribeTrainingJobCommand, StopTrainingJobCommand } = require('@aws-sdk/client-sagemaker');

function makeClient({ accessKeyId, secretAccessKey, region }) {
  return new SageMakerClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

async function testConnection({ accessKeyId, secretAccessKey, region }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  // ListTrainingJobs with a 1-item page is a lightweight, harmless way
  // to confirm the credentials actually work and have SageMaker access.
  const { ListTrainingJobsCommand } = require('@aws-sdk/client-sagemaker');
  await client.send(new ListTrainingJobsCommand({ MaxResults: 1 }));
  return { ok: true, externalAccountId: region };
}

// GPU tier → SageMaker instance type
const GPU_TIER_MAP = {
  'Flash — Single GPU': 'ml.g5.xlarge',
  'Pro — H100 80GB': 'ml.p5.48xlarge', // AWS's H100 instances are only sold in the full 8-GPU p5.48xlarge shape; a real Pro-tier job would use a fraction via a shared cluster, noted as a real limitation
  'Ultra — 8× H100': 'ml.p5.48xlarge',
};

async function submitTrainingJob({ accessKeyId, secretAccessKey, region, executionRoleArn, s3Bucket, jobConfig }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const instanceType = GPU_TIER_MAP[jobConfig.gpuTier] || GPU_TIER_MAP['Flash — Single GPU'];
  const trainingJobName = `corverxis-${jobConfig.trainingJobId}`.slice(0, 63); // SageMaker's own name-length limit

  const command = new CreateTrainingJobCommand({
    TrainingJobName: trainingJobName,
    RoleArn: executionRoleArn,
    AlgorithmSpecification: {
      TrainingImage: jobConfig.containerImage || `763104351884.dkr.ecr.${region}.amazonaws.com/pytorch-training:2.3-gpu-py311`,
      TrainingInputMode: 'File',
    },
    HyperParameters: {
      model_type: jobConfig.modelType,
      base_model: jobConfig.baseModel || '',
      method: jobConfig.method || '',
      corverxis_api_base_url: jobConfig.apiBaseUrl,
      corverxis_training_job_id: jobConfig.trainingJobId,
      // NOTE: the data source API key is passed as a hyperparameter here,
      // which SageMaker surfaces in its console/logs — for a production
      // deployment this should go through SageMaker's Secrets Manager
      // integration instead of a plain hyperparameter. Flagged here
      // rather than silently shipped insecurely.
      corverxis_api_key: jobConfig.dataSourceApiKey,
    },
    InputDataConfig: jobConfig.datasetS3Uri ? [{
      ChannelName: 'training',
      DataSource: { S3DataSource: { S3DataType: 'S3Prefix', S3Uri: jobConfig.datasetS3Uri, S3DataDistributionType: 'FullyReplicated' } },
    }] : [],
    OutputDataConfig: { S3OutputPath: `s3://${s3Bucket}/corverxis-training-output/${trainingJobName}/` },
    ResourceConfig: { InstanceType: instanceType, InstanceCount: 1, VolumeSizeInGB: 50 },
    StoppingCondition: { MaxRuntimeInSeconds: 86400 }, // 24h ceiling — a real deployment should make this configurable per job
  });

  await client.send(command);

  return {
    externalJobId: trainingJobName,
    providerLogsUrl: `https://${region}.console.aws.amazon.com/sagemaker/home?region=${region}#/jobs/${trainingJobName}`,
    status: 'QUEUED',
  };
}

async function getJobStatus({ accessKeyId, secretAccessKey, region, externalJobId }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  const result = await client.send(new DescribeTrainingJobCommand({ TrainingJobName: externalJobId }));
  // InProgress, Completed, Failed, Stopping, Stopped
  const statusMap = { InProgress: 'RUNNING', Completed: 'COMPLETED', Failed: 'FAILED', Stopping: 'RUNNING', Stopped: 'FAILED' };
  return { status: statusMap[result.TrainingJobStatus] || 'QUEUED', raw: result };
}

async function stopJob({ accessKeyId, secretAccessKey, region, externalJobId }) {
  const client = makeClient({ accessKeyId, secretAccessKey, region });
  await client.send(new StopTrainingJobCommand({ TrainingJobName: externalJobId }));
  return { ok: true };
}

module.exports = { testConnection, submitTrainingJob, getJobStatus, stopJob };
