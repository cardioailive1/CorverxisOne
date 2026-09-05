/**
 * Real A100 instance catalog — accurate instance types, GPU counts,
 * and approximate on-demand pricing (US regions, as of early 2026;
 * cloud pricing changes and this should be treated as directional,
 * matching the same "illustrative, not billed truth" caveat used
 * throughout this platform's ROI figures).
 */

const AWS_A100_INSTANCES = [
  { instanceType: 'p4d.24xlarge', gpuType: 'A100-40GB', gpuCount: 8, vcpus: 96, memoryGb: 1152, costPerHourUsd: 32.77 },
  { instanceType: 'p4de.24xlarge', gpuType: 'A100-80GB', gpuCount: 8, vcpus: 96, memoryGb: 1152, costPerHourUsd: 40.96 },
];

const GCP_A100_INSTANCES = [
  { instanceType: 'a2-highgpu-1g', gpuType: 'A100-40GB', gpuCount: 1, vcpus: 12, memoryGb: 85, costPerHourUsd: 3.67 },
  { instanceType: 'a2-highgpu-2g', gpuType: 'A100-40GB', gpuCount: 2, vcpus: 24, memoryGb: 170, costPerHourUsd: 7.35 },
  { instanceType: 'a2-highgpu-4g', gpuType: 'A100-40GB', gpuCount: 4, vcpus: 48, memoryGb: 340, costPerHourUsd: 14.69 },
  { instanceType: 'a2-highgpu-8g', gpuType: 'A100-40GB', gpuCount: 8, vcpus: 96, memoryGb: 680, costPerHourUsd: 29.39 },
  { instanceType: 'a2-ultragpu-1g', gpuType: 'A100-80GB', gpuCount: 1, vcpus: 12, memoryGb: 170, costPerHourUsd: 5.03 },
  { instanceType: 'a2-ultragpu-8g', gpuType: 'A100-80GB', gpuCount: 8, vcpus: 96, memoryGb: 1360, costPerHourUsd: 40.22 },
];

function findAwsInstance(instanceType) {
  const found = AWS_A100_INSTANCES.find((i) => i.instanceType === instanceType);
  if (!found) throw new Error(`Unknown AWS A100 instance type: ${instanceType}. Known types: ${AWS_A100_INSTANCES.map((i) => i.instanceType).join(', ')}`);
  return found;
}

function findGcpInstance(instanceType) {
  const found = GCP_A100_INSTANCES.find((i) => i.instanceType === instanceType);
  if (!found) throw new Error(`Unknown GCP A100 instance type: ${instanceType}. Known types: ${GCP_A100_INSTANCES.map((i) => i.instanceType).join(', ')}`);
  return found;
}

module.exports = { AWS_A100_INSTANCES, GCP_A100_INSTANCES, findAwsInstance, findGcpInstance };
