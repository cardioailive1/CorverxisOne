/**
 * The real scheduler — this is what actually closes the gap flagged
 * after the first A100 build: idle-timeout enforcement and queue
 * processing previously ONLY ran when something called the endpoint.
 * This runs on a real setInterval inside the running server process
 * (a Render web service stays up continuously — this is not a
 * serverless/lambda deploy, so an in-process timer is a legitimate,
 * simple mechanism here, not a hack).
 *
 * Honest about what this still isn't: a single Node process's
 * setInterval is not a durable job queue — if the server restarts
 * mid-cycle, that cycle is just skipped, not persisted and retried.
 * For a production deployment with real reliability requirements,
 * an external cron hitting the enforce-idle-timeout /
 * process-queue endpoints (Render Cron Jobs, or a real queue like
 * BullMQ) is the more durable answer. This in-process scheduler is a
 * genuine improvement over "only runs when a human clicks a button,"
 * not a claim of production-grade durability.
 */

let schedulerInterval = null;

async function processOrgQueue(prisma, rawCompute, orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { maxConcurrentInstances: true } });
  if (!org) return { launched: 0, stillQueued: 0 };

  // Deliberately excludes not-yet-launched queue placeholders
  // (externalInstanceId still null) from the active count — those
  // aren't consuming any real cloud capacity yet, only instances that
  // actually made it through a launch() call are. Counting placeholders
  // here was a real bug: it made the queue self-block, since every
  // placeholder counted against its own capacity check before ever
  // getting a chance to launch. Caught by testing this exact scenario.
  const activeCount = await prisma.computeInstance.count({
    where: { orgId, status: { in: ['PROVISIONING', 'BOOTING', 'RUNNING'] }, externalInstanceId: { not: null } },
  });
  const capacity = Math.max(0, org.maxConcurrentInstances - activeCount);
  if (capacity === 0) return { launched: 0, stillQueued: -1 }; // -1 signals "didn't even check, fleet is full" vs a real 0-queued count

  // Jobs that were queued specifically FOR compute dispatch — tracked via
  // a pending ComputeInstance placeholder created by the queue-submit
  // endpoint (see the new POST /lab/training-jobs/:id/queue-on-compute
  // route), oldest first (real FIFO, not an implicit/arbitrary order).
  const pending = await prisma.computeInstance.findMany({
    where: { orgId, status: 'PROVISIONING', externalInstanceId: null },
    orderBy: { createdAt: 'asc' },
    take: capacity,
    include: { provider: true, trainingJob: true },
  });

  let launched = 0;
  for (const placeholder of pending) {
    try {
      const launchResult = await rawCompute.launch(placeholder.provider, placeholder.instanceType, {
        trainingJobId: placeholder.trainingJobId || placeholder.id,
        apiBaseUrl: process.env.APP_URL || 'https://localhost',
        dataSourceApiKey: null,
        modelType: placeholder.trainingJob?.modelType, baseModel: placeholder.trainingJob?.baseModel, method: placeholder.trainingJob?.method,
      });
      await prisma.computeInstance.update({
        where: { id: placeholder.id },
        data: { externalInstanceId: launchResult.externalInstanceId, status: 'PROVISIONING', launchedAt: new Date() },
      });
      if (placeholder.trainingJobId) {
        await prisma.labTrainingJob.update({ where: { id: placeholder.trainingJobId }, data: { status: 'QUEUED' } }).catch(() => {});
      }
      launched++;
    } catch (e) {
      console.error(`⚠ Scheduler: queued launch failed for placeholder ${placeholder.id} (will retry next cycle):`, e.message);
    }
  }

  const stillQueuedCount = await prisma.computeInstance.count({ where: { orgId, status: 'PROVISIONING', externalInstanceId: null } });
  return { launched, stillQueued: stillQueuedCount };
}

async function enforceIdleTimeoutForOrg(prisma, rawCompute, orgId, maxHours = 12) {
  const cutoff = new Date(Date.now() - maxHours * 3600000);
  const stale = await prisma.computeInstance.findMany({
    where: { orgId, status: { in: ['PROVISIONING', 'BOOTING', 'RUNNING'] }, launchedAt: { lt: cutoff } },
    include: { provider: true },
  });
  const terminated = [];
  for (const instance of stale) {
    try {
      if (instance.externalInstanceId) await rawCompute.terminate(instance.provider, instance.externalInstanceId);
      await prisma.computeInstance.update({ where: { id: instance.id }, data: { status: 'TERMINATING', terminationReason: 'idle_timeout' } });
      terminated.push(instance.id);
    } catch (e) {
      console.error(`⚠ Scheduler: idle-timeout termination failed for instance ${instance.id} (will retry next cycle):`, e.message);
    }
  }
  return terminated;
}

async function runCycle(prisma, rawCompute) {
  try {
    const orgs = await prisma.org.findMany({ select: { id: true } });
    for (const org of orgs) {
      const queueResult = await processOrgQueue(prisma, rawCompute, org.id);
      const terminatedIds = await enforceIdleTimeoutForOrg(prisma, rawCompute, org.id);
      if (queueResult.launched > 0 || terminatedIds.length > 0) {
        console.log(`[scheduler] org ${org.id}: launched ${queueResult.launched} queued job(s), idle-timed-out ${terminatedIds.length} instance(s)`);
      }
    }
  } catch (e) {
    console.error('⚠ Scheduler cycle failed (non-fatal, will retry next interval):', e.message);
  }
}

function startScheduler(prisma, rawCompute, intervalMs = 5 * 60000) {
  if (schedulerInterval) return; // idempotent — calling this twice (e.g. in a test) doesn't double the interval
  schedulerInterval = setInterval(() => runCycle(prisma, rawCompute), intervalMs);
  console.log(`✓ Compute scheduler started — checking every ${intervalMs / 60000} minute(s)`);
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

module.exports = { startScheduler, stopScheduler, runCycle, processOrgQueue, enforceIdleTimeoutForOrg };
