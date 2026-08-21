/**
 * Change Management API Routes
 * ==================================================
 * GET   /api/v1/change/dashboard          → aggregate KPIs
 * GET   /api/v1/change/initiatives        → list rollout initiatives
 * POST  /api/v1/change/initiatives        → create initiative
 * PATCH /api/v1/change/initiatives/:id    → update phase/adoption/sentiment/status
 * GET   /api/v1/change/communications     → communication log
 * POST  /api/v1/change/communications     → log a new communication
 * GET   /api/v1/change/risks              → risk register
 * POST  /api/v1/change/risks              → add risk
 * PATCH /api/v1/change/risks/:id          → update status/mitigation
 */

const express = require('express');
const router  = express.Router();
const { prisma } = require('../prisma');
const { authenticate, requireRole } = require('../middleware/rbac');

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/change/dashboard', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const [initiatives, comms, risks, trainingCount] = await Promise.all([
      prisma.changeInitiative.findMany({ where: { orgId } }),
      prisma.changeCommunication.count({ where: { orgId } }),
      prisma.changeRisk.findMany({ where: { orgId } }),
      prisma.hrTraining.count({ where: { orgId, changeTrainingModelId: { not: null } } }),
    ]);

    const avgAdoption  = initiatives.length ? initiatives.reduce((a,i) => a+i.adoptionPct, 0) / initiatives.length : 0;
    const avgSentiment = initiatives.length ? initiatives.reduce((a,i) => a+i.sentimentScore, 0) / initiatives.length : 0;
    const openRisks     = risks.filter(r => r.status !== 'RESOLVED').length;

    res.json({
      data: {
        activeInitiatives: initiatives.filter(i => i.status !== 'COMPLETE').length,
        avgAdoptionPct: Math.round(avgAdoption * 10) / 10,
        avgSentimentScore: Math.round(avgSentiment * 10) / 10,
        openRisks,
        communicationsSent: comms,
        aiTrainingRecords: trainingCount,
        byPhase: {
          DATA_FOUNDATION: initiatives.filter(i => i.phase === 'DATA_FOUNDATION').length,
          PILOT: initiatives.filter(i => i.phase === 'PILOT').length,
          SCALING: initiatives.filter(i => i.phase === 'SCALING').length,
          CONTINUOUS_IMPROVEMENT: initiatives.filter(i => i.phase === 'CONTINUOUS_IMPROVEMENT').length,
        },
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── INITIATIVES ──────────────────────────────────────────────
router.get('/change/initiatives', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { pillar, phase, status } = req.query;
    const where = { orgId };
    if (pillar) where.pillar = pillar;
    if (phase) where.phase = phase;
    if (status) where.status = status;
    const rows = await prisma.changeInitiative.findMany({ where, orderBy: { updatedAt: 'desc' } });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/change/initiatives', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.changeInitiative.create({
      data: {
        orgId, title: b.title, pillar: b.pillar, phase: b.phase || 'DATA_FOUNDATION',
        ownerName: b.ownerName || null, targetDept: b.targetDept || null, linkedModule: b.linkedModule || null,
        description: b.description || null,
        adoptionPct: b.adoptionPct != null ? Number(b.adoptionPct) : 0,
        sentimentScore: b.sentimentScore != null ? Number(b.sentimentScore) : 70,
        status: b.status || 'ON_TRACK',
        targetDate: b.targetDate ? new Date(b.targetDate) : null,
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/change/initiatives/:id', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['title','pillar','phase','ownerName','targetDept','linkedModule','description','status'].forEach(k => {
      if (b[k] !== undefined) data[k] = b[k];
    });
    if (b.adoptionPct != null) data.adoptionPct = Number(b.adoptionPct);
    if (b.sentimentScore != null) data.sentimentScore = Number(b.sentimentScore);
    if (b.targetDate) data.targetDate = new Date(b.targetDate);
    const row = await prisma.changeInitiative.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COMMUNICATIONS ───────────────────────────────────────────
router.get('/change/communications', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const rows = await prisma.changeCommunication.findMany({ where: { orgId }, orderBy: { sentAt: 'desc' } });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/change/communications', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.changeCommunication.create({
      data: {
        orgId, initiativeId: b.initiativeId || null, title: b.title,
        audience: b.audience || null, channel: b.channel || null, summary: b.summary || null,
        sentAt: b.sentAt ? new Date(b.sentAt) : new Date(),
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RISK REGISTER ─────────────────────────────────────────────
router.get('/change/risks', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const rows = await prisma.changeRisk.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' } });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/change/risks', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.changeRisk.create({
      data: {
        orgId, title: b.title, category: b.category, severity: b.severity || 'MEDIUM',
        mitigation: b.mitigation || null, linkedModule: b.linkedModule || null,
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/change/risks/:id', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['status','severity','mitigation','title','linkedModule'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    const row = await prisma.changeRisk.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TRAINING MODELS — structured AI upskilling curricula ──────
router.get('/change/training-models', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const models = await prisma.changeTrainingModel.findMany({
      where: { orgId },
      include: { enrollments: { select: { status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const data = models.map(m => {
      const total = m.enrollments.length;
      const completed = m.enrollments.filter(e => e.status === 'COMPLETED').length;
      const { enrollments, ...rest } = m;
      return {
        ...rest,
        enrollmentCount: total,
        completedCount: completed,
        completionPct: total ? Math.round((completed / total) * 1000) / 10 : 0,
      };
    });
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/change/training-models', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const b = req.body;
    const row = await prisma.changeTrainingModel.create({
      data: {
        orgId, pillar: b.pillar, title: b.title, description: b.description || null,
        format: b.format || 'Self-Paced', durationHours: b.durationHours != null ? Number(b.durationHours) : 2,
        targetRole: b.targetRole || null, status: b.status || 'ACTIVE',
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/change/training-models/:id', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    ['title','description','format','targetRole','status','pillar'].forEach(k => { if (b[k] !== undefined) data[k] = b[k]; });
    if (b.durationHours != null) data.durationHours = Number(b.durationHours);
    const row = await prisma.changeTrainingModel.update({ where: { id: req.params.id }, data });
    res.json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enroll (assign) an employee into a training model — creates a real
// HrTraining record linked back to the model, so completion tracking
// is genuinely live rather than string-matched.
router.post('/change/training-models/:id/assign', authenticate, requireRole('MANAGER'), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const model = await prisma.changeTrainingModel.findFirst({ where: { id: req.params.id, orgId } });
    if (!model) return res.status(404).json({ error: 'Training model not found' });
    const { employeeId, dueDate } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });

    const row = await prisma.hrTraining.create({
      data: {
        orgId, employeeId, courseName: model.title, provider: 'Corverxis Change Academy',
        changeTrainingModelId: model.id, dueDate: dueDate ? new Date(dueDate) : null, status: 'NOT_STARTED',
      }
    });
    res.status(201).json({ data: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/change/training-models/:id/enrollments', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const rows = await prisma.hrTraining.findMany({
      where: { orgId, changeTrainingModelId: req.params.id },
      include: { employee: { select: { firstName:true, lastName:true, jobTitle:true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
