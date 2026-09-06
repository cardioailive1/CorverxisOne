/**
 * Corverxis ERP Integration Routes
 * ==================================
 * POST /api/erp/work-order        → accept WO from any ERP system
 * POST /api/erp/work-orders/batch → bulk upsert up to 100 WOs
 * POST /api/erp/ncr               → accept NCR from client QMS
 * GET  /api/erp/status            → check ERP connection status
 * GET  /api/automation/ncrs       → list all auto-raised NCRs
 * GET  /api/automation/log        → automation event log
 * POST /api/erp/test              → test payload normalisation without saving
 */

const express    = require('express');
const router     = express.Router();
const { prisma } = require('../prisma');
const {
  autoWoFromErp,
  autoNcrFromVisionFail,
  autoNcrFromSensorCrit,
  sendNotification,
  nextSequence,
  normaliseErpWo,
} = require('../automation');
const { authenticate, requireRole } = require('../middleware/rbac');

// ── ERP API Key middleware ────────────────────────────────────
// ERP systems use a static API key rather than JWT
// Set ERP_API_KEY env var in Render dashboard
function erpAuth(req, res, next) {
  // Allow normal JWT auth (for testing from browser)
  const cookie = req.cookies?.cvx_session;
  if (cookie) return next(); // JWT user — handled by authenticate further up

  // ERP API key auth
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'Unauthorized', message: 'Provide x-api-key header or api_key query param' });
  if (key !== process.env.ERP_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  req.user = { role: 'ENGINEER', orgId: null, name: 'ERP Integration' };
  next();
}

// ── POST /api/erp/work-order ─────────────────────────────────
// Single WO from ERP — supports SAP, Oracle, Infor, generic JSON
router.post('/work-order', erpAuth, async (req, res) => {
  try {
    const result = await autoWoFromErp({
      payload: req.body,
      orgId:   req.user?.orgId || null,
      source:  req.headers['x-erp-source'] || 'erp-webhook',
    });
    res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      ...result,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/erp/work-orders/batch ──────────────────────────
// Bulk upsert — accepts array of WO payloads
router.post('/work-orders/batch', erpAuth, async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders array required' });
    if (orders.length > 100) return res.status(400).json({ error: 'Max 100 orders per batch' });

    const results = [];
    const errors  = [];

    for (const payload of orders) {
      try {
        const r = await autoWoFromErp({
          payload,
          orgId:  req.user?.orgId || null,
          source: req.headers['x-erp-source'] || 'erp-batch',
        });
        results.push(r);
      } catch (e) {
        errors.push({ payload: normaliseErpWo(payload)?.number || '?', error: e.message });
      }
    }

    res.status(207).json({
      success:  errors.length === 0,
      created:  results.filter(r => r.action === 'created').length,
      updated:  results.filter(r => r.action === 'updated').length,
      errors:   errors.length,
      results,
      errorList: errors,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp/ncr ─────────────────────────────────────────
// Accept NCR from client QMS (ETQ, MasterControl, Qualio etc.)
router.post('/ncr', erpAuth, async (req, res) => {
  try {
    const {
      number, partNumber, customer, defectType, severity = 'MAJOR',
      description, quantityAffected = 0, source,
    } = req.body;

    if (!partNumber) return res.status(400).json({ error: 'partNumber required' });

    const org = await prisma.org.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) return res.status(500).json({ error: 'No organisation configured' });

    const ncrNumber = number || await nextSequence(org.id, 'ncr', 'NCR');

    // Check duplicate
    const existing = await prisma.ncr.findFirst({ where: { number: ncrNumber, orgId: org.id } });
    if (existing) return res.status(409).json({ error: 'NCR already exists', number: ncrNumber });

    const ncr = await prisma.ncr.create({
      data: {
        number:           ncrNumber,
        partNumber,
        customer:         customer || null,
        defectType:       defectType || null,
        severity:         severity.toUpperCase(),
        description:      description || null,
        quantityAffected: parseInt(quantityAffected) || 0,
        orgId:            org.id,
        status:           'OPEN',
        autoRaised:       true,
        autoSource:       source || req.headers['x-erp-source'] || 'external-qms',
      },
    });

    await sendNotification({
      orgId:   org.id,
      subject: `[ERP-NCR] ${ncrNumber} — ${partNumber} (${severity})`,
      body:    `An NCR has been received from the external QMS system.\n\n` +
               `NCR:       ${ncrNumber}\nPart:      ${partNumber}\n` +
               `Customer:  ${customer || '—'}\nSeverity:  ${severity}\n` +
               `Source:    ${source || 'External QMS'}\n\n` +
               `Log in to CorverxisONE → QMS to action.`,
    });

    res.status(201).json({ success: true, number: ncrNumber, id: ncr.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/erp/test ────────────────────────────────────────
// Test payload normalisation without saving to DB
router.post('/test', erpAuth, (req, res) => {
  const normalised = normaliseErpWo(req.body);
  res.json({ success: true, normalised, raw: req.body });
});

// ── GET /api/erp/status ───────────────────────────────────────
router.get('/status', erpAuth, async (req, res) => {
  // req.user.orgId is null for the external-ERP-key auth path (a
  // single global ERP_API_KEY isn't scoped to one org — a real,
  // separate gap from what this fixes) but IS correctly populated
  // for the session-cookie path, which is what CorverxisONE's own
  // frontend actually uses. Scoping by it when present fixes a real
  // bug: these counts were previously global across every org.
  const orgId = req.user.orgId;
  const woWhere = orgId ? { orgId } : {};
  const ncrWhere = orgId ? { orgId } : {};
  const [wos, ncrs, autoNcrs, recentLogs] = await Promise.all([
    prisma.workOrder.count({ where: woWhere }),
    prisma.ncr.count({ where: ncrWhere }),
    prisma.ncr.count({ where: { ...ncrWhere, autoRaised: true } }),
    prisma.emailLog.findMany({ where: orgId ? { orgId } : {}, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  res.json({
    status:   'connected',
    platform: 'CorverxisONE',
    db: { workOrders: wos, ncrs, autoRaisedNcrs: autoNcrs },
    smtp:     !!process.env.SMTP_HOST,
    erpKey:   !!process.env.ERP_API_KEY,
    recentNotifications: recentLogs.map(l => ({
      subject: l.subject, status: l.status, sentAt: l.sentAt,
    })),
    endpoints: {
      singleWO:  'POST /api/erp/work-order',
      batchWO:   'POST /api/erp/work-orders/batch',
      ncr:       'POST /api/erp/ncr',
      test:      'POST /api/erp/test',
    },
    auth: 'Header: x-api-key: <ERP_API_KEY>',
    formats: ['generic-json', 'sap-idoc', 'oracle', 'infor'],
  });
});

// ── GET /api/automation/ncrs ──────────────────────────────────
// List all auto-raised NCRs with source info — ADMIN+
router.get('/automation/ncrs', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { limit = 50, status } = req.query;
    const where = { orgId: req.user.orgId, autoRaised: true };
    if (status) where.status = status;
    const ncrs = await prisma.ncr.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });
    res.json({ data: ncrs, count: ncrs.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/automation/log ───────────────────────────────────
// Notification/email log — ADMIN+
router.get('/automation/log', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const logs = await prisma.emailLog.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ data: logs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/erp/dashboard ────────────────────────────────────
// Real data for the ERP Integration Hub page — replaces the
// previously fully-hardcoded ERP_SYSTEMS array (9 fake systems, all
// marked LIVE, with string-literal timestamps like "2s ago" that
// never actually updated). There is no real SAP/Salesforce/Workday
// connector code anywhere in this codebase — building 9 real
// individual integrations is a different, much larger project than
// what this fixes. What genuinely exists and IS real: CorverxisLab's
// LabDataSource connections (ERP/API_FEED/MES/SCADA_HISTORIAN types),
// which already have real status, real API keys, and real ingestion
// tracking (see src/routes/lab.js). This surfaces those, honestly, as
// "your org's actual connected integrations" — which may be zero.
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const [wos, autoRaisedWos, ncrs, autoNcrs, recentLogs, dataSources] = await Promise.all([
      prisma.workOrder.count({ where: { orgId } }),
      prisma.workOrder.count({ where: { orgId, autoRaised: true } }),
      prisma.ncr.count({ where: { orgId } }),
      prisma.ncr.count({ where: { orgId, autoRaised: true } }),
      prisma.emailLog.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.labDataSource.findMany({
        where: { orgId, type: { in: ['ERP', 'MES', 'SCADA_HISTORIAN', 'API_FEED'] } },
        include: { _count: { select: { ingestionEvents: true } }, project: { select: { title: true, pillar: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const connectedCount = dataSources.filter(d => d.status === 'CONNECTED').length;
    const erroredCount = dataSources.filter(d => d.status === 'ERROR').length;
    const totalRecordsIngested = dataSources.reduce((a, d) => a + d.recordsIngested, 0);

    res.json({
      data: {
        summary: {
          activeIntegrations: connectedCount,
          totalConfigured: dataSources.length,
          errors: erroredCount,
          workOrders: wos, autoRaisedWorkOrders: autoRaisedWos, ncrs, autoRaisedNcrs: autoNcrs,
          totalRecordsIngested,
        },
        // Real connections — genuinely empty for an org that hasn't
        // configured any yet, not padded out with fake entries.
        connections: dataSources.map(d => ({
          id: d.id, name: d.name, type: d.type, status: d.status, origin: d.origin,
          lastSyncAt: d.lastSyncAt, recordsIngested: d.recordsIngested,
          ingestionEventCount: d._count.ingestionEvents,
          project: d.project?.title, pillar: d.project?.pillar,
        })),
        recentNotifications: recentLogs.map(l => ({ subject: l.subject, status: l.status, sentAt: l.sentAt, createdAt: l.createdAt })),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
