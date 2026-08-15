/**
 * Corverxis Platform — Prisma Seed
 * Seeds demo org, assets, sensors, vision jobs
 * Run: npx prisma db seed
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SENSOR_GROUPS = [
  {
    vertical: 'Manufacturing',
    asset: 'CNC Production Line',
    location: 'Building A — Line 1',
    sensors: [
      { name: 'Spindle Vibration',    type: 'mfg_vib',   unit: 'mm/s',  algo: 'ensemble',
        thresholds: { warn: 4.2,  crit: 8.5  } },
      { name: 'Spindle Bearing Temp', type: 'mfg_temp',  unit: 'C',     algo: 'ekf',
        thresholds: { warn: 65,   crit: 85   } },
      { name: 'Motor Drive Current',  type: 'mfg_curr',  unit: 'A',     algo: 'lstm',
        thresholds: { warn: 28,   crit: 38   } },
      { name: 'Hydraulic Pressure',   type: 'mfg_press', unit: 'bar',   algo: 'arima',
        thresholds: { warn: 145,  crit: 160  } },
    ],
  },
  {
    vertical: 'Aerospace',
    asset: 'Aerospace Test Cell',
    location: 'Building B — Test Cell 1',
    sensors: [
      { name: 'Engine Fan Vibration', type: 'aero_vib',  unit: 'g RMS', algo: 'fourier',
        thresholds: { warn: 2.5,  crit: 5.0  } },
      { name: 'EGT Exhaust Gas Temp', type: 'aero_temp', unit: 'C',     algo: 'ensemble',
        thresholds: { warn: 720,  crit: 800  } },
      { name: 'Engine Oil Pressure',  type: 'aero_oil',  unit: 'psi',   algo: 'ekf',
        thresholds: { warn: 45,   crit: 35   } },
      { name: 'Hydraulic System',     type: 'aero_hyd',  unit: 'psi',   algo: 'lstm',
        thresholds: { warn: 3200, crit: 3400 } },
    ],
  },
  {
    vertical: 'EV Battery',
    asset: 'EV Battery Pack Assembly',
    location: 'Building C — Line 6',
    sensors: [
      { name: 'Battery Cell Temp',    type: 'ev_temp',   unit: 'C',     algo: 'ensemble',
        thresholds: { warn: 45,   crit: 60   } },
      { name: 'Cell Voltage',         type: 'ev_volt',   unit: 'V',     algo: 'ekf',
        thresholds: { warn: 4.18, crit: 4.25 } },
      { name: 'Pack Charge Current',  type: 'ev_curr',   unit: 'A',     algo: 'lstm',
        thresholds: { warn: 120,  crit: 180  } },
      { name: 'State of Charge',      type: 'ev_soc',    unit: '%',     algo: 'arima',
        thresholds: { warn: 15,   crit: 8    } },
    ],
  },
  {
    vertical: 'Mining',
    asset: 'Underground Mining Level 3',
    location: 'Level 3 — West Drift',
    sensors: [
      { name: 'Crusher Bearing Vib.', type: 'min_vib',   unit: 'mm/s',  algo: 'ensemble',
        thresholds: { warn: 8.5,  crit: 18   } },
      { name: 'Methane Concentration',type: 'min_gas',   unit: '% LEL', algo: 'fourier',
        thresholds: { warn: 20,   crit: 40   } },
      { name: 'Respirable Dust',      type: 'min_dust',  unit: 'mg/m3', algo: 'lstm',
        thresholds: { warn: 2.0,  crit: 3.5  } },
      { name: 'Roof Support Load',    type: 'min_str',   unit: 't',     algo: 'arima',
        thresholds: { warn: 72,   crit: 90   } },
    ],
  },
  {
    vertical: 'Power Systems',
    asset: 'Grid Transformer Station',
    location: 'Substation Alpha',
    sensors: [
      { name: 'Transformer Current',  type: 'pwr_curr',  unit: 'A',     algo: 'ekf',
        thresholds: { warn: 520,  crit: 600  } },
      { name: 'Transformer Oil Temp', type: 'pwr_temp',  unit: 'C',     algo: 'lstm',
        thresholds: { warn: 80,   crit: 95   } },
      { name: 'Partial Discharge',    type: 'pwr_pdis',  unit: 'pC',    algo: 'fourier',
        thresholds: { warn: 100,  crit: 500  } },
      { name: 'Grid Frequency',       type: 'pwr_freq',  unit: 'Hz',    algo: 'arima',
        thresholds: { warn: 49.8, crit: 49.5 } },
    ],
  },
  {
    vertical: 'Automotive',
    asset: 'Brake Caliper Assembly Line',
    location: 'Building A — Line 2',
    sensors: [
      { name: 'Press Force',          type: 'auto_force',unit: 'kN',    algo: 'ensemble',
        thresholds: { warn: 85,   crit: 95   } },
      { name: 'Weld Temperature',     type: 'auto_weld', unit: 'C',     algo: 'lstm',
        thresholds: { warn: 720,  crit: 780  } },
      { name: 'Torque Verify',        type: 'auto_torq', unit: 'Nm',    algo: 'ekf',
        thresholds: { warn: 48,   crit: 52   } },
      { name: 'Part Present Sensor',  type: 'auto_pres', unit: 'bool',  algo: 'fourier',
        thresholds: { warn: 0.5,  crit: 0    } },
    ],
  },
  {
    vertical: 'Renewable Energy',
    asset: 'Wind Turbine Farm',
    location: 'Site West — Turbines 1-8',
    sensors: [
      { name: 'Gearbox Vibration',    type: 're_vib',    unit: 'mm/s',  algo: 'ensemble',
        thresholds: { warn: 9.0,  crit: 18   } },
      { name: 'Wind Active Power',    type: 're_power',  unit: 'kW',    algo: 'lstm',
        thresholds: { warn: 600,  crit: 200  } },
      { name: 'Rotor Speed',          type: 're_rpm',    unit: 'RPM',   algo: 'fourier',
        thresholds: { warn: 1700, crit: 1850 } },
      { name: 'Nacelle Temperature',  type: 're_temp',   unit: 'C',     algo: 'arima',
        thresholds: { warn: 75,   crit: 90   } },
    ],
  },
  {
    vertical: 'Healthcare',
    asset: 'Patient Monitoring Station',
    location: 'ICU Ward B',
    sensors: [
      { name: 'ECG Heart Rate',       type: 'hth_ecg',   unit: 'bpm',   algo: 'ekf',
        thresholds: { warn: 100,  crit: 130  } },
      { name: 'SpO2 Saturation',      type: 'hth_spo2',  unit: '%',     algo: 'lstm',
        thresholds: { warn: 94,   crit: 90   } },
      { name: 'Blood Pressure Sys',   type: 'hth_bp',    unit: 'mmHg',  algo: 'arima',
        thresholds: { warn: 140,  crit: 180  } },
      { name: 'Respiratory Rate',     type: 'hth_rr',    unit: 'br/min',algo: 'fourier',
        thresholds: { warn: 22,   crit: 28   } },
    ],
  },
];

const VISION_JOBS = [
  { name: 'BRK_CAL_LINE2',  partNumber: '48210-06290', revision: 'Rev G', tool: 'defect'   },
  { name: 'BRG_RACE_LINE3', partNumber: 'BRG-6205-C3', revision: 'Rev B', tool: 'measure'  },
  { name: 'PCB_ASSY_SMT',   partNumber: 'PCB-ECU-V3',  revision: 'Rev A', tool: 'pattern'  },
  { name: 'WELD_INSP_B2',   partNumber: 'WLD-4410',    revision: 'Rev C', tool: 'defect'   },
  { name: 'AERO_STRUT_L5',  partNumber: 'AS9-4410',    revision: 'Rev F', tool: 'measure'  },
];

async function main() {
  console.log('🌱 Seeding Corverxis Platform...');

  // ── Org ─────────────────────────────────────────────────────────────────────
  const org = await prisma.org.upsert({
    where:  { slug: 'corverxis-demo' },
    update: {},
    create: { name: 'Corverxis Demo Organisation', slug: 'corverxis-demo', plan: 'ENTERPRISE' },
  });
  console.log(`✓ Org: ${org.name}`);

  // ── Super Admin user ─────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where:  { email: process.env.ADMIN_EMAIL || 'admin@corverxis.com' },
    update: {},
    create: {
      email:       process.env.ADMIN_EMAIL || 'admin@corverxis.com',
      name:        'Corverxis Admin',
      role:        'SUPER_ADMIN',
      orgId:       org.id,
      approved:    true,
      approvedAt:  new Date(),
      registeredAt: new Date(),
    },
  });
  console.log(`✓ Admin user: ${admin.email}`);

  // ── Assets + Sensors ─────────────────────────────────────────────────────────
  let totalSensors = 0;
  for (const group of SENSOR_GROUPS) {
    const asset = await prisma.asset.upsert({
      where:  { id: `asset-${group.vertical.toLowerCase().replace(/\s/g,'-')}` },
      update: {},
      create: {
        id:          `asset-${group.vertical.toLowerCase().replace(/\s/g,'-')}`,
        name:        group.asset,
        description: `${group.vertical} monitoring asset`,
        orgId:       org.id,
        vertical:    group.vertical,
        location:    group.location,
      },
    });

    for (const s of group.sensors) {
      await prisma.sensor.upsert({
        where:  { id: `sensor-${s.type}` },
        update: {},
        create: {
          id:          `sensor-${s.type}`,
          name:        s.name,
          type:        s.type,
          unit:        s.unit,
          assetId:     asset.id,
          mlAlgorithm: s.algo,
          thresholds:  s.thresholds,
        },
      });
      totalSensors++;
    }
  }
  console.log(`✓ Assets: ${SENSOR_GROUPS.length} | Sensors: ${totalSensors}`);

  // ── Vision Jobs ──────────────────────────────────────────────────────────────
  for (const job of VISION_JOBS) {
    await prisma.visionJob.upsert({
      where:  { id: `vjob-${job.name.toLowerCase()}` },
      update: {},
      create: {
        id:         `vjob-${job.name.toLowerCase()}`,
        name:       job.name,
        partNumber: job.partNumber,
        revision:   job.revision,
        tool:       job.tool,
      },
    });
  }
  console.log(`✓ Vision jobs: ${VISION_JOBS.length}`);

  console.log('\n✅ Seed complete!');
  console.log(`   Org: ${org.name} (${org.slug})`);
  console.log(`   Admin: ${admin.email}`);
  console.log(`   Sensors: ${totalSensors} across ${SENSOR_GROUPS.length} verticals`);
  console.log(`   Vision jobs: ${VISION_JOBS.length}`);
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

// ── Additional seed for dynamic data ─────────────────────────────────────────
async function seedDynamicData() {
  console.log('🌱 Seeding dynamic data...');

  // Find the demo org
  const org = await prisma.org.findUnique({ where: { slug: 'corverxis-demo' } });
  if (!org) { console.log('Run main seed first'); return; }

  // ── Production Lines ────────────────────────────────────────────────────────
  const lineData = [
    { id:'line-1', name:'Line 1 — Engine Mounts',    location:'Building A', description:'Engine mount assembly' },
    { id:'line-2', name:'Line 2 — Brake Calipers',   location:'Building A', description:'Brake caliper machining and assembly' },
    { id:'line-3', name:'Line 3 — Turbochargers',    location:'Building B', description:'Turbocharger assembly and test' },
    { id:'line-4', name:'Line 4 — Fuel Systems',     location:'Building B', description:'Fuel injector and pump assembly' },
    { id:'line-5', name:'Line 5 — Aerospace Struts', location:'Building C', description:'Aerospace structural components' },
    { id:'line-6', name:'Line 6 — EV Battery Trays', location:'Building C', description:'EV battery tray assembly' },
  ];

  for (const l of lineData) {
    await prisma.productionLine.upsert({
      where: { id: l.id }, update: {},
      create: { ...l, orgId: org.id },
    });
  }
  console.log(`✓ Production lines: ${lineData.length}`);

  // ── Work Orders ─────────────────────────────────────────────────────────────
  const woData = [
    { id:'wo-2851', number:'WO-2851', partNumber:'48210-06290', customer:'Toyota',   quantity:1200, completed:984,  status:'IN_PROGRESS', lineId:'line-2', priority:1, dueDate: new Date(Date.now()+3*3600000) },
    { id:'wo-2849', number:'WO-2849', partNumber:'EM-4471',     customer:'BMW',      quantity:600,  completed:570,  status:'IN_PROGRESS', lineId:'line-1', priority:2, dueDate: new Date(Date.now()+2*3600000) },
    { id:'wo-2847', number:'WO-2847', partNumber:'ABS-881',     customer:'Ford',     quantity:2400, completed:984,  status:'ON_HOLD',     lineId:'line-4', priority:2, dueDate: new Date(Date.now()+18*3600000) },
    { id:'wo-2845', number:'WO-2845', partNumber:'TC-2291',     customer:'Mercedes', quantity:150,  completed:150,  status:'COMPLETED',   lineId:'line-3', priority:3, dueDate: new Date(Date.now()-2*3600000) },
    { id:'wo-2844', number:'WO-2844', partNumber:'AS9-4410',    customer:'Airbus',   quantity:24,   completed:16,   status:'IN_PROGRESS', lineId:'line-5', priority:1, dueDate: new Date(Date.now()+48*3600000) },
    { id:'wo-2843', number:'WO-2843', partNumber:'BT-EV220',    customer:'Tesla',    quantity:400,  completed:220,  status:'IN_PROGRESS', lineId:'line-6', priority:2, dueDate: new Date(Date.now()+30*3600000) },
    { id:'wo-2840', number:'WO-2840', partNumber:'FI-7821',     customer:'GM',       quantity:3600, completed:1008, status:'IN_PROGRESS', lineId:'line-4', priority:1, dueDate: new Date(Date.now()+8*3600000) },
  ];

  for (const wo of woData) {
    await prisma.workOrder.upsert({ where: { id: wo.id }, update: {}, create: { ...wo, orgId: org.id } });
  }
  console.log(`✓ Work orders: ${woData.length}`);

  // ── Suppliers ───────────────────────────────────────────────────────────────
  const supplierData = [
    { id:'sup-continental', name:'Continental AG',      category:'Electronics',  otif:97, qualityPpm:8,  score:94, rating:'PREFERRED',    country:'DE' },
    { id:'sup-magna',       name:'Magna International', category:'Structures',   otif:95, qualityPpm:15, score:91, rating:'APPROVED',     country:'CA' },
    { id:'sup-parker',      name:'Parker Hannifin',     category:'Hydraulics',   otif:91, qualityPpm:22, score:84, rating:'CONDITIONAL',  country:'US' },
    { id:'sup-bosch',       name:'Bosch GmbH',          category:'Sensors',      otif:88, qualityPpm:31, score:78, rating:'WATCH',        country:'DE' },
    { id:'sup-precision',   name:'Precision Castparts', category:'Aerospace',    otif:99, qualityPpm:2,  score:98, rating:'PREFERRED',    country:'US' },
    { id:'sup-henkel',      name:'Henkel AG',           category:'Chemicals',    otif:93, qualityPpm:0,  score:89, rating:'APPROVED',     country:'DE' },
  ];

  for (const s of supplierData) {
    await prisma.supplier.upsert({ where: { id: s.id }, update: {}, create: { ...s, orgId: org.id } });
  }
  console.log(`✓ Suppliers: ${supplierData.length}`);

  // ── NCRs ────────────────────────────────────────────────────────────────────
  const ncrData = [
    { id:'ncr-0291', number:'NCR-0291', partNumber:'48210-06290', customer:'Toyota',   defectType:'Dimensional',    severity:'CRITICAL', description:'OD +0.12mm over tolerance', status:'OPEN', quantityAffected:24, workOrderId:'wo-2851' },
    { id:'ncr-0290', number:'NCR-0290', partNumber:'FI-7821',     customer:'GM',       defectType:'Surface Finish', severity:'CRITICAL', description:'Surface finish Ra 1.8um vs 1.6um spec', status:'OPEN', quantityAffected:120 },
    { id:'ncr-0289', number:'NCR-0289', partNumber:'EM-4471',     customer:'BMW',      defectType:'Hardness',       severity:'MAJOR',    description:'Hardness 58 HRC (min 60 HRC)', status:'IN_PROGRESS', quantityAffected:6 },
    { id:'ncr-0288', number:'NCR-0288', partNumber:'AS9-4410',    customer:'Airbus',   defectType:'Visual',         severity:'MINOR',    description:'Cosmetic scratch on non-critical surface', status:'CLOSED', quantityAffected:1 },
    { id:'ncr-0287', number:'NCR-0287', partNumber:'TC-2291',     customer:'Mercedes', defectType:'Functional',     severity:'MAJOR',    description:'Imbalance 0.4g.mm (max 0.3g.mm)', status:'IN_PROGRESS', quantityAffected:3 },
  ];

  for (const n of ncrData) {
    await prisma.ncr.upsert({ where: { id: n.id }, update: {}, create: { ...n, orgId: org.id } });
  }
  console.log(`✓ NCRs: ${ncrData.length}`);

  // ── SCARs ───────────────────────────────────────────────────────────────────
  await prisma.scar.upsert({
    where: { id: 'scar-0041' }, update: {},
    create: { id:'scar-0041', number:'SCAR-0041', supplierId:'sup-bosch',
              issue:'ABS sensor intermittent failure — field return', severity:'CRITICAL',
              status:'OPEN', d8Status:'D4 - Root Cause', ncrId:'ncr-0291',
              dueAt: new Date(Date.now()+5*24*3600000) },
  });
  await prisma.scar.upsert({
    where: { id: 'scar-0040' }, update: {},
    create: { id:'scar-0040', number:'SCAR-0040', supplierId:'sup-parker',
              issue:'Hydraulic seal dimensional OOT', severity:'MAJOR',
              status:'ESCALATED', d8Status:'D3 - Containment',
              dueAt: new Date(Date.now()-2*24*3600000) },
  });
  console.log('✓ SCARs: 2');

  // ── Seed initial sensor readings ────────────────────────────────────────────
  const sensors = await prisma.sensor.findMany();
  const BASES = { mfg_vib:1.2,mfg_temp:85.2,mfg_curr:18,mfg_press:120,
    aero_vib:0.8,aero_temp:620,aero_oil:65,aero_hyd:3000,
    ev_temp:28,ev_volt:3.7,ev_curr:45,ev_soc:75,
    min_vib:2.8,min_gas:2,min_dust:0.8,min_str:45,
    pwr_curr:420,pwr_temp:55,pwr_pdis:15,pwr_freq:50,
    auto_force:72,auto_weld:680,auto_torq:42,auto_pres:1,
    re_vib:3.5,re_power:1850,re_rpm:1450,re_temp:48,
    hth_ecg:72,hth_spo2:98,hth_bp:120,hth_rr:16 };

  for (const s of sensors) {
    const base = BASES[s.type] || 50;
    const thr  = s.thresholds;
    // Seed 10 historical readings per sensor
    for (let i = 0; i < 10; i++) {
      const val = Math.max(0, base + (Math.random()-0.5)*base*0.1);
      const ts  = new Date(Date.now() - (10-i)*2*60000);
      const status = thr.crit && val >= thr.crit ? 'CRITICAL' :
                     thr.warn && val >= thr.warn ? 'WARNING' : 'OK';
      await prisma.sensorReading.create({
        data: { sensorId: s.id, value: parseFloat(val.toFixed(3)), quality: 1.0, status, timestamp: ts },
      }).catch(() => {});
    }
    // Seed a prediction for each sensor
    await prisma.prediction.create({
      data: { sensorId: s.id, algorithm: s.mlAlgorithm || 'ensemble',
              predicted: parseFloat((base * (0.95 + Math.random()*0.1)).toFixed(3)),
              confidence: parseFloat((85 + Math.random()*14).toFixed(1)),
              rulHours: s.type === 'mfg_temp' ? 48 : (200 + Math.random()*1000),
              features: {} },
    }).catch(() => {});
  }
  console.log(`✓ Sensor readings + predictions seeded`);

  // ── Seed active vision session ───────────────────────────────────────────────
  const vJob = await prisma.visionJob.findFirst();
  if (vJob) {
    const vsess = await prisma.visionSession.upsert({
      where: { id: 'vsess-demo' }, update: {},
      create: { id:'vsess-demo', jobId: vJob.id,
                totalCount:3114, passCount:3061, failCount:53, avgCycleMs:142 },
    });
    console.log('✓ Vision session seeded');
  }

  // ── Seed critical alert for mfg_temp ────────────────────────────────────────
  const tempSensor = await prisma.sensor.findUnique({ where: { id: 'sensor-mfg_temp' } });
  if (tempSensor) {
    await prisma.alert.upsert({
      where: { id: 'alert-bearing-crit' }, update: {},
      create: { id:'alert-bearing-crit', sensorId: tempSensor.id,
                severity:'CRITICAL', type:'threshold_breach',
                message:'CNC Spindle Bearing Temp CRITICAL: 87.2°C (threshold 85°C) — RUL est. 48h',
                value: 87.2, threshold: 85, resolved: false },
    });
    console.log('✓ Critical alert seeded');
  }

  console.log('\n✅ Dynamic data seed complete!');
}

// Run both
main()
  .then(() => seedDynamicData())
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
