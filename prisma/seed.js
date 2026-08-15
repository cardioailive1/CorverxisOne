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
