/**
 * CorverxisLab API Routes
 * ==================================================
 * GET   /api/v1/lab/projects                          → all lab projects (one per pilot pillar)
 * POST  /api/v1/lab/projects                           → create a project
 * GET   /api/v1/lab/projects/:id                        → single project with full detail
 * PATCH /api/v1/lab/projects/:id                        → update phase/description
 * POST  /api/v1/lab/projects/seed-defaults               → create the 4 pillar projects (idempotent, live)
 *
 * GET   /api/v1/lab/projects/:id/data-sources            → list
 * POST  /api/v1/lab/projects/:id/data-sources            → add a data source
 * PATCH /api/v1/lab/data-sources/:id                     → update status/records
 *
 * GET   /api/v1/lab/projects/:id/pipelines                → list
 * POST  /api/v1/lab/projects/:id/pipelines                → add a pipeline
 * PATCH /api/v1/lab/pipelines/:id                         → update status/run
 *
 * GET   /api/v1/lab/projects/:id/datasets                 → list
 * POST  /api/v1/lab/projects/:id/datasets                 → register a dataset
 *
 * GET   /api/v1/lab/projects/:id/training-jobs            → list
 * POST  /api/v1/lab/projects/:id/training-jobs            → launch a training job
 * PATCH /api/v1/lab/training-jobs/:id                     → update status/progress/metrics
 *
 * GET   /api/v1/lab/projects/:id/models                   → list
 * POST  /api/v1/lab/projects/:id/models                   → register a model
 * PATCH /api/v1/lab/models/:id                            → update status/deploy flag
 *
 * GET   /api/v1/lab/dashboard                             → org-wide lab KPI rollup
 */

const express = require('express');
const router  = express.Router();
const { prisma } = require('../prisma');
const { authenticate, requireRole } = require('../middleware/rbac');

// ── Default projects: one per pilot pillar, matching the Pilot Studies tab ──
const DEFAULT_PROJECTS = [
  {
    pillar: 'PREDICTIVE_MAINTENANCE', title: 'Predictive Maintenance — Lab Build',
    clientSiteName: 'TBD — CNC Machining Cell', courseSlug: 'predictive-maintenance',
    description: 'IIoT sensor onboarding, RUL model training, and the data pipeline behind the Predictive Maintenance pilot.',
  },
  {
    pillar: 'QUALITY_CONTROL', title: 'Computer Vision QC — Lab Build',
    clientSiteName: 'TBD — Inspection Station', courseSlug: 'vision-qc',
    description: 'Camera calibration, labeled defect datasets, and CNN training behind the Computer Vision QC pilot.',
  },
  {
    pillar: 'SUPPLY_CHAIN', title: 'Supply Chain AI — Lab Build',
    clientSiteName: 'TBD — Critical Material Category', courseSlug: 'supply-chain-ai',
    description: 'ERP consumption data pipeline and demand-forecast model training behind the Supply Chain AI pilot.',
  },
  {
    pillar: 'PROCESS_OPTIMIZATION', title: 'Process Optimization — Lab Build',
    clientSiteName: 'TBD — CNC Cell / Part Number', courseSlug: 'golden-batch',
    description: 'Historical MES data pipeline and Golden Batch parameter-combination model training.',
  },
];

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/lab/dashboard', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const [projects, dataSources, pipelines, datasets, jobs, models] = await Promise.all([
      prisma.labProject.findMany({ where: { orgId } }),
      prisma.labDataSource.findMany({ where: { orgId } }),
      prisma.labPipeline.findMany({ where: { orgId } }),
      prisma.labDataset.findMany({ where: { orgId } }),
      prisma.labTrainingJob.findMany({ where: { orgId } }),
      prisma.labModel.findMany({ where: { orgId } }),
    ]);
    res.json({
      data: {
        totalProjects: projects.length,
        connectedSources: dataSources.filter(d => d.status === 'CONNECTED').length,
        totalSources: dataSources.length,
        activePipelines: pipelines.filter(p => p.status === 'ACTIVE').length,
        totalDatasets: datasets.length,
        totalRows: datasets.reduce((a, d) => a + d.rowCount, 0),
        runningJobs: jobs.filter(j => j.status === 'RUNNING').length,
        completedJobs: jobs.filter(j => j.status === 'COMPLETED').length,
        productionModels: models.filter(m => m.status === 'PRODUCTION').length,
        deployedToPilot: models.filter(m => m.deployedToPilot).length,
        byPhase: {
          SITE_ONBOARDING: projects.filter(p => p.phase === 'SITE_ONBOARDING').length,
          DATA_INFRASTRUCTURE: projects.filter(p => p.phase === 'DATA_INFRASTRUCTURE').length,
          COLLECTION_PROCESSING: projects.filter(p => p.phase === 'COLLECTION_PROCESSING').length,
          TRAINING_PIPELINE: projects.filter(p => p.phase === 'TRAINING_PIPELINE').length,
          MODEL_TRAINING: projects.filter(p => p.phase === 'MODEL_TRAINING').length,
          VALIDATION: projects.filter(p => p.phase === 'VALIDATION').length,
        },
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PROJECTS ─────────────────────────────────────────────────
router.get('/lab/projects', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const projects = await prisma.labProject.findMany({
      where: { orgId },
      include: {
        _count: { select: { dataSources: true, pipelines: true, datasets: true, trainingJobs: true, models: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ data: projects });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects/seed-defaults', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const existing = await prisma.labProject.count({ where: { orgId } });
    if (existing > 0) {
      const rows = await prisma.labProject.findMany({ where: { orgId } });
      return res.json({ data: rows, created: 0, message: `${existing} lab project(s) already exist.` });
    }
    const created = [];
    for (const p of DEFAULT_PROJECTS) {
      created.push(await prisma.labProject.create({ data: { orgId, ...p } }));
    }
    res.status(201).json({ data: created, created: created.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.labProject.create({
      data: {
        orgId, title: b.title, pillar: b.pillar, phase: b.phase || 'SITE_ONBOARDING',
        clientSiteName: b.clientSiteName || null, description: b.description || null, courseSlug: b.courseSlug || null,
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/lab/projects/:id', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const project = await prisma.labProject.findFirst({
      where: { id: req.params.id, orgId },
      include: {
        dataSources: { orderBy: { createdAt: 'desc' } },
        pipelines: { orderBy: { createdAt: 'desc' } },
        datasets: { orderBy: { createdAt: 'desc' } },
        trainingJobs: { orderBy: { createdAt: 'desc' }, include: { dataset: { select: { name: true, version: true } } } },
        models: { orderBy: { createdAt: 'desc' }, include: { versions: { orderBy: { createdAt: 'desc' }, take: 5 } } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Lab project not found' });
    res.json({ data: project });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/lab/projects/:id', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['title', 'phase', 'clientSiteName', 'description'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    const row = await prisma.labProject.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DATA SOURCES (site onboarding / integration) ─────────────
router.get('/lab/projects/:id/data-sources', authenticate, async (req, res) => {
  try {
    const rows = await prisma.labDataSource.findMany({ where: { projectId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects/:id/data-sources', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.labDataSource.create({
      data: { orgId, projectId: req.params.id, name: b.name, type: b.type, status: b.status || 'NOT_CONNECTED', notes: b.notes || null }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/lab/data-sources/:id', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['status', 'name', 'notes'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    if (b.recordsIngested != null) data.recordsIngested = Number(b.recordsIngested);
    if (data.status === 'CONNECTED') data.lastSyncAt = new Date();
    const row = await prisma.labDataSource.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PIPELINES (data infrastructure / processing) ─────────────
router.get('/lab/projects/:id/pipelines', authenticate, async (req, res) => {
  try {
    const rows = await prisma.labPipeline.findMany({ where: { projectId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects/:id/pipelines', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.labPipeline.create({
      data: { orgId, projectId: req.params.id, name: b.name, stage: b.stage, status: b.status || 'DRAFT' }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/lab/pipelines/:id', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['status', 'name'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    if (b.recordsProcessed != null) data.recordsProcessed = Number(b.recordsProcessed);
    if (data.status === 'ACTIVE') data.lastRunAt = new Date();
    const row = await prisma.labPipeline.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DATASETS ─────────────────────────────────────────────────
router.get('/lab/projects/:id/datasets', authenticate, async (req, res) => {
  try {
    const rows = await prisma.labDataset.findMany({ where: { projectId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects/:id/datasets', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.labDataset.create({
      data: {
        orgId, projectId: req.params.id, name: b.name, version: b.version || 'v1',
        rowCount: b.rowCount != null ? Number(b.rowCount) : 0, sizeMb: b.sizeMb != null ? Number(b.sizeMb) : 0,
        splitTrainPct: b.splitTrainPct != null ? Number(b.splitTrainPct) : 70,
        splitValPct: b.splitValPct != null ? Number(b.splitValPct) : 15,
        splitTestPct: b.splitTestPct != null ? Number(b.splitTestPct) : 15,
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TRAINING JOBS ────────────────────────────────────────────
router.get('/lab/projects/:id/training-jobs', authenticate, async (req, res) => {
  try {
    const rows = await prisma.labTrainingJob.findMany({
      where: { projectId: req.params.id }, orderBy: { createdAt: 'desc' },
      include: { dataset: { select: { name: true, version: true } } },
    });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects/:id/training-jobs', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.labTrainingJob.create({
      data: {
        orgId, projectId: req.params.id, datasetId: b.datasetId || null, modelType: b.modelType,
        baseModel: b.baseModel || null, method: b.method || null, gpuTier: b.gpuTier || null,
        status: 'QUEUED',
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/lab/training-jobs/:id', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['status', 'baseModel', 'method', 'gpuTier'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    if (b.progressPct != null) data.progressPct = Number(b.progressPct);
    if (b.metrics !== undefined) data.metrics = b.metrics;
    if (data.status === 'RUNNING' && !data.startedAt) data.startedAt = new Date();
    if (data.status === 'COMPLETED') { data.completedAt = new Date(); data.progressPct = 100; }
    const row = await prisma.labTrainingJob.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MODELS ───────────────────────────────────────────────────
router.get('/lab/projects/:id/models', authenticate, async (req, res) => {
  try {
    const rows = await prisma.labModel.findMany({
      where: { projectId: req.params.id }, orderBy: { createdAt: 'desc' },
      include: { versions: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lab/projects/:id/models', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.labModel.create({
      data: { orgId, projectId: req.params.id, name: b.name, type: b.type, status: b.status || 'DRAFT' }
    });
    await prisma.labModelVersion.create({ data: { modelId: row.id, version: 'v1' } });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/lab/models/:id', authenticate, requireRole('ENGINEER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['status', 'name', 'latestVersion'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    if (b.accuracyPct != null) data.accuracyPct = Number(b.accuracyPct);
    if (b.deployedToPilot != null) data.deployedToPilot = !!b.deployedToPilot;
    const row = await prisma.labModel.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
