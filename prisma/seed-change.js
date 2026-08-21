const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedChange() {
  const org = await prisma.org.findUnique({ where: { slug: 'corverxis-demo' } });
  if (!org) { console.log('⚠ No demo org found — skipping Change Management seed'); return; }

  const existing = await prisma.changeInitiative.count({ where: { orgId: org.id } });
  if (existing > 0) { console.log(`✓ Change Management already seeded (${existing} initiatives) — skipping`); return; }

  const INITIATIVES = [
    {
      title: 'Predictive Maintenance Rollout — CNC & Robotic Cells',
      pillar: 'PREDICTIVE_MAINTENANCE', phase: 'SCALING', ownerName: 'VP Manufacturing',
      targetDept: 'Manufacturing Ops', linkedModule: 'pred',
      description: 'IoT-sensor-driven vibration, temperature, and acoustic monitoring on CNC machines and robotic cells to predict tool wear and machine failure before it happens.',
      adoptionPct: 68, sentimentScore: 82, status: 'ON_TRACK',
    },
    {
      title: 'AI-Powered Optical Inspection — Computer Vision QC',
      pillar: 'QUALITY_CONTROL', phase: 'PILOT', ownerName: 'Quality Director',
      targetDept: 'Quality Engineering', linkedModule: 'vision',
      description: 'AI-powered optical inspection to catch micro-defects in precision parts that traditional gauges or the human eye miss, targeting 100% quality compliance.',
      adoptionPct: 34, sentimentScore: 71, status: 'ON_TRACK',
    },
    {
      title: 'AI-Driven Supply Chain & Inventory Optimization',
      pillar: 'SUPPLY_CHAIN', phase: 'PILOT', ownerName: 'Supply Chain Manager',
      targetDept: 'Supply Chain', linkedModule: 'supply',
      description: 'Demand-pattern and lead-time analysis for raw materials (steel, aluminum) to improve inventory management and reduce carrying costs.',
      adoptionPct: 41, sentimentScore: 76, status: 'ON_TRACK',
    },
    {
      title: '"Golden Batch" Process Optimization',
      pillar: 'PROCESS_OPTIMIZATION', phase: 'DATA_FOUNDATION', ownerName: 'Process Engineering Lead',
      targetDept: 'Manufacturing Ops', linkedModule: 'pia',
      description: 'ML analysis of historical production data to identify the optimal combination of speed, feed rate, and coolant pressure — maximizing output while minimizing energy use and scrap.',
      adoptionPct: 12, sentimentScore: 65, status: 'AT_RISK',
    },
  ];

  const created = [];
  for (const i of INITIATIVES) {
    const row = await prisma.changeInitiative.create({ data: { orgId: org.id, ...i } });
    created.push(row);
  }
  console.log(`✓ Change Management: ${created.length} initiatives seeded across 4 pillars`);

  const RISKS = [
    { title: 'Data Silos — legacy MES not fully integrated with ERP', category: 'DATA_SILOS', severity: 'HIGH', mitigation: 'Complete ERP↔MES integration via ERP Integration Hub before scaling further pilots.', linkedModule: 'erp' },
    { title: 'Expanded attack surface from shop-floor network connectivity', category: 'CYBERSECURITY', severity: 'HIGH', mitigation: 'Segment OT network from IT network; enforce least-privilege access for sensor gateways.', linkedModule: 'aiops' },
    { title: 'Skill gap — limited in-house ML/data analyst capacity', category: 'SKILL_GAP', severity: 'MEDIUM', mitigation: 'Partner with external AI consultants short-term; hire 2 data analysts with manufacturing OT background.', linkedModule: 'hrim' },
    { title: 'Shop-floor resistance — fear that AI signals future layoffs', category: 'RESISTANCE', severity: 'MEDIUM', mitigation: 'Reframe as upskilling, not replacement; involve operators directly in AI system design.', linkedModule: 'hrim' },
  ];
  for (const r of RISKS) {
    await prisma.changeRisk.create({ data: { orgId: org.id, ...r } });
  }
  console.log(`✓ Change Management: ${RISKS.length} risks seeded`);

  const COMMS = [
    { title: 'Town Hall: Why We\'re Piloting Predictive Maintenance', audience: 'All Plant Floor', channel: 'Town Hall', summary: 'Leadership explained the predictive maintenance pilot goal — reducing unplanned downtime, not headcount — and invited operator feedback.', initiativeId: created[0]?.id },
    { title: 'Computer Vision QC Pilot — Line 3 Kickoff Notice', audience: 'Line 3 Operators & QA', channel: 'Posted Notice', summary: 'Announced the optical inspection pilot on Line 3, with a two-week shadow period before the system goes live.', initiativeId: created[1]?.id },
    { title: 'AI Adoption FAQ — Upskilling Not Replacing', audience: 'All Employees', channel: 'Email', summary: 'Company-wide email addressing common concerns about AI and automation, reinforcing the upskilling commitment.', initiativeId: null },
  ];
  for (const c of COMMS) {
    await prisma.changeCommunication.create({ data: { orgId: org.id, ...c } });
  }
  console.log(`✓ Change Management: ${COMMS.length} communications seeded`);

  const TRAINING_MODELS = [
    {
      pillar: 'PREDICTIVE_MAINTENANCE', title: 'Predictive Maintenance for Operators',
      description: 'How to read AI-flagged RUL alerts, interpret vibration/temperature trend charts, and escalate before a machine crash — not after.',
      format: 'Hands-On Shadow', durationHours: 3, targetRole: 'Machine Operators, Maintenance Technicians',
    },
    {
      pillar: 'QUALITY_CONTROL', title: 'Computer Vision QC Certification',
      description: 'Operating the AI optical inspection stations, understanding pass/fail confidence scores, and handling edge cases the model flags for human review.',
      format: 'Instructor-Led', durationHours: 4, targetRole: 'Quality Inspectors, Line Operators',
    },
    {
      pillar: 'SUPPLY_CHAIN', title: 'AI-Assisted Supply & Inventory Planning',
      description: 'Reading AI demand forecasts, adjusting reorder points, and validating model recommendations against supplier lead-time reality.',
      format: 'Self-Paced', durationHours: 2.5, targetRole: 'Supply Chain Analysts, Buyers',
    },
    {
      pillar: 'PROCESS_OPTIMIZATION', title: 'Process Data & Golden Batch Analytics',
      description: 'Understanding how the ML model identifies optimal speed/feed/coolant combinations, and how to validate findings on the floor.',
      format: 'Self-Paced', durationHours: 3, targetRole: 'Process Engineers, Line Supervisors',
    },
    {
      pillar: 'OTHER', title: 'AI Literacy 101 — Upskilling, Not Replacing',
      description: 'Company-wide foundation course: what AI does and doesn\'t do on the floor, how it makes jobs safer, and how to raise concerns.',
      format: 'Self-Paced', durationHours: 1, targetRole: 'All Employees',
    },
  ];

  const modelRows = [];
  for (const t of TRAINING_MODELS) {
    const row = await prisma.changeTrainingModel.create({ data: { orgId: org.id, ...t } });
    modelRows.push(row);
  }
  console.log(`✓ Change Management: ${modelRows.length} training models seeded across all pillars`);

  // Enroll a sample of existing employees so completion tracking has real data to show
  const sampleEmployees = await prisma.hrEmployee.findMany({ where: { orgId: org.id, status: 'ACTIVE' }, take: 20 });
  if (sampleEmployees.length) {
    let enrolled = 0;
    for (const model of modelRows) {
      const shuffled = [...sampleEmployees].sort(() => Math.random() - 0.5).slice(0, Math.min(6, sampleEmployees.length));
      for (const emp of shuffled) {
        const roll = Math.random();
        const status = roll < 0.4 ? 'COMPLETED' : roll < 0.75 ? 'IN_PROGRESS' : 'NOT_STARTED';
        await prisma.hrTraining.create({
          data: {
            orgId: org.id, employeeId: emp.id, courseName: model.title, provider: 'Corverxis Change Academy',
            changeTrainingModelId: model.id, status,
            completedAt: status === 'COMPLETED' ? new Date() : null,
          }
        }).catch(() => {});
        enrolled++;
      }
    }
    console.log(`✓ Change Management: ${enrolled} training enrollments seeded`);
  }
}

module.exports = { seedChange };

if (require.main === module) {
  seedChange()
    .catch((e) => { console.error('❌ Change Management seed failed:', e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
}
