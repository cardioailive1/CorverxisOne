#!/usr/bin/env node
/**
 * Corverxis IIoT Gateway Agent
 * ==================================================
 * This runs ON-PREM at the client's plant — on an edge gateway, an
 * industrial PC, or a small server on the OT network — NOT in the
 * cloud. It reads sensor data locally and pushes it up to
 * CorverxisLab over HTTPS, so the OT network never needs an inbound
 * connection from the internet (matching the OT/IT segmentation
 * principle covered in the Predictive Maintenance training course).
 *
 * Two modes:
 *   MODE=opcua     → connects to a real OPC-UA server via node-opcua
 *                     and reads live tag values on an interval.
 *   MODE=simulate  → generates realistic vibration/temperature/
 *                     acoustic/current-draw readings (baseline +
 *                     gradual drift + occasional spikes), for testing
 *                     the pipeline before real hardware is wired up.
 *
 * Configuration is via environment variables (see .env.example) or a
 * config.json file in this directory — env vars take precedence.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env   # fill in your values
 *   node agent.js
 *
 * Run as a persistent service in production — see README.md for
 * systemd / pm2 examples.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── Config ───────────────────────────────────────────────────
function loadConfig() {
  let fileConfig = {};
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    try { fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (e) { console.error('⚠ config.json exists but failed to parse:', e.message); }
  }
  const env = process.env;
  const cfg = {
    apiBaseUrl:     env.CORVERXIS_API_BASE_URL     || fileConfig.apiBaseUrl     || 'https://your-corverxis-deployment.onrender.com',
    dataSourceId:   env.CORVERXIS_DATA_SOURCE_ID   || fileConfig.dataSourceId,
    apiKey:         env.CORVERXIS_API_KEY          || fileConfig.apiKey,
    mode:           (env.MODE                       || fileConfig.mode || 'simulate').toLowerCase(),
    pushIntervalMs: Number(env.PUSH_INTERVAL_MS    || fileConfig.pushIntervalMs || 30000),
    sampleHz:       Number(env.SAMPLE_HZ           || fileConfig.sampleHz || 1), // readings per second, batched then pushed every pushIntervalMs
    // OPC-UA specific
    opcuaEndpoint:  env.OPCUA_ENDPOINT_URL         || fileConfig.opcuaEndpoint,
    opcuaNodeIds:   (env.OPCUA_NODE_IDS            || fileConfig.opcuaNodeIds || '').split(',').map(s => s.trim()).filter(Boolean),
    // Modbus TCP specific
    modbusHost:     env.MODBUS_HOST                || fileConfig.modbusHost,
    modbusPort:     Number(env.MODBUS_PORT         || fileConfig.modbusPort || 502),
    modbusUnitId:   Number(env.MODBUS_UNIT_ID      || fileConfig.modbusUnitId || 1),
    // Comma-separated "name:register:type" triples, e.g. "vibration:0:holding,temperature:2:holding"
    modbusRegisters: (env.MODBUS_REGISTERS         || fileConfig.modbusRegisters || '').split(',').map(s => s.trim()).filter(Boolean),
    // MQTT specific
    mqttBrokerUrl:  env.MQTT_BROKER_URL            || fileConfig.mqttBrokerUrl,
    mqttTopics:     (env.MQTT_TOPICS               || fileConfig.mqttTopics || '').split(',').map(s => s.trim()).filter(Boolean),
  };
  if (!cfg.dataSourceId || !cfg.apiKey) {
    console.error('❌ Missing required config: CORVERXIS_DATA_SOURCE_ID and CORVERXIS_API_KEY must be set (env vars or config.json).');
    console.error('   Get these by creating a data source in CorverxisLab — the API key is shown once at creation.');
    process.exit(1);
  }
  return cfg;
}

// ── HTTPS push to CorverxisLab ─────────────────────────────────
function pushBatch(cfg, records) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/v1/lab/data-sources/${cfg.dataSourceId}/ingest`, cfg.apiBaseUrl);
    const body = JSON.stringify({ records });
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        } else {
          reject(new Error(`Ingestion rejected (${res.statusCode}): ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Simulate mode: realistic sensor noise, not random garbage ───
// Mirrors the failure-progression pattern described in the
// Predictive Maintenance course: a stable baseline, slow drift, and
// occasional realistic spikes — not uniform random noise, which no
// real sensor actually produces.
function makeSimulator() {
  const state = {
    vibration:   { base: 1.8, drift: 0, unit: 'mm/s' },
    temperature: { base: 55,  drift: 0, unit: '°C' },
    acoustic:    { base: 42,  drift: 0, unit: 'dB' },
    current:     { base: 12.5, drift: 0, unit: 'A' },
  };
  return function sample() {
    const readings = [];
    const now = Date.now();
    for (const [param, s] of Object.entries(state)) {
      // Slow random walk for drift, small chance of a brief spike
      s.drift += (Math.random() - 0.48) * 0.02; // slight upward bias over time, like real degradation
      s.drift = Math.max(0, s.drift);
      const spike = Math.random() < 0.01 ? s.base * (0.15 + Math.random() * 0.25) : 0;
      const noise = (Math.random() - 0.5) * s.base * 0.03;
      const value = Math.round((s.base + s.drift + spike + noise) * 1000) / 1000;
      readings.push({ parameter: param, value, unit: s.unit, timestamp: new Date(now).toISOString() });
    }
    return readings;
  };
}

// ── OPC-UA mode: real industrial protocol client ────────────────
// Requires the optional `node-opcua` dependency (see package.json).
// Not loaded unless MODE=opcua, so `npm install` stays light for
// anyone just running the simulator against the pipeline.
async function makeOpcuaReader(cfg) {
  let opcua;
  try {
    opcua = require('node-opcua');
  } catch (e) {
    console.error('❌ MODE=opcua requires the node-opcua package. Run: npm install node-opcua');
    process.exit(1);
  }
  if (!cfg.opcuaEndpoint || !cfg.opcuaNodeIds.length) {
    console.error('❌ MODE=opcua requires OPCUA_ENDPOINT_URL and OPCUA_NODE_IDS (comma-separated) to be set.');
    process.exit(1);
  }

  const client = opcua.OPCUAClient.create({ endpointMustExist: false });
  console.log(`Connecting to OPC-UA server at ${cfg.opcuaEndpoint} ...`);
  await client.connect(cfg.opcuaEndpoint);
  const session = await client.createSession();
  console.log('✓ OPC-UA session established');

  return {
    sample: async () => {
      const nodesToRead = cfg.opcuaNodeIds.map((nodeId) => ({ nodeId, attributeId: opcua.AttributeIds.Value }));
      const results = await session.read(nodesToRead);
      return results.map((r, i) => ({
        parameter: cfg.opcuaNodeIds[i],
        value: r.value && typeof r.value.value === 'number' ? r.value.value : null,
        timestamp: new Date().toISOString(),
      })).filter((r) => r.value !== null);
    },
    close: async () => { await session.close(); await client.disconnect(); },
  };
}

// ── Modbus TCP mode: common on older PLCs/plant equipment ──────
// Requires the optional `modbus-serial` dependency. Reads holding or
// input registers by address — the client's PLC documentation or
// integrator specifies which addresses map to which real values.
async function makeModbusReader(cfg) {
  let ModbusRTU;
  try {
    ModbusRTU = require('modbus-serial');
  } catch (e) {
    console.error('❌ MODE=modbus requires the modbus-serial package. Run: npm install modbus-serial');
    process.exit(1);
  }
  if (!cfg.modbusHost || !cfg.modbusRegisters.length) {
    console.error('❌ MODE=modbus requires MODBUS_HOST and MODBUS_REGISTERS (name:address:type, comma-separated) to be set.');
    process.exit(1);
  }

  const registers = cfg.modbusRegisters.map((r) => {
    const [name, address, type] = r.split(':');
    return { name, address: Number(address), type: (type || 'holding').toLowerCase() };
  });

  const client = new ModbusRTU();
  console.log(`Connecting to Modbus TCP at ${cfg.modbusHost}:${cfg.modbusPort} (unit ${cfg.modbusUnitId}) ...`);
  await client.connectTCP(cfg.modbusHost, { port: cfg.modbusPort });
  client.setID(cfg.modbusUnitId);
  console.log('✓ Modbus TCP connection established');

  return {
    sample: async () => {
      const readings = [];
      for (const reg of registers) {
        try {
          const result = reg.type === 'input'
            ? await client.readInputRegisters(reg.address, 1)
            : await client.readHoldingRegisters(reg.address, 1);
          readings.push({ parameter: reg.name, value: result.data[0], timestamp: new Date().toISOString() });
        } catch (e) {
          console.error(`⚠ Modbus read failed for ${reg.name} (register ${reg.address}):`, e.message);
        }
      }
      return readings;
    },
    close: async () => { client.close(() => {}); },
  };
}

// ── MQTT mode: subscribes to a broker, buffers messages between ──
// pushes rather than polling on an interval. Requires the optional
// `mqtt` dependency. Expects each message payload to be JSON shaped
// like { parameter, value } or a bare number (topic name used as
// the parameter in that case).
async function makeMqttReader(cfg) {
  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch (e) {
    console.error('❌ MODE=mqtt requires the mqtt package. Run: npm install mqtt');
    process.exit(1);
  }
  if (!cfg.mqttBrokerUrl || !cfg.mqttTopics.length) {
    console.error('❌ MODE=mqtt requires MQTT_BROKER_URL and MQTT_TOPICS (comma-separated) to be set.');
    process.exit(1);
  }

  let buffer = [];
  console.log(`Connecting to MQTT broker at ${cfg.mqttBrokerUrl} ...`);
  const client = mqtt.connect(cfg.mqttBrokerUrl);

  await new Promise((resolve, reject) => {
    client.on('connect', () => {
      console.log('✓ MQTT connected, subscribing to:', cfg.mqttTopics.join(', '));
      client.subscribe(cfg.mqttTopics, (err) => { if (err) reject(err); else resolve(); });
    });
    client.on('error', reject);
  });

  client.on('message', (topic, payload) => {
    try {
      const parsed = JSON.parse(payload.toString());
      if (typeof parsed === 'number') {
        buffer.push({ parameter: topic, value: parsed, timestamp: new Date().toISOString() });
      } else if (parsed && typeof parsed.value === 'number') {
        buffer.push({ parameter: parsed.parameter || topic, value: parsed.value, timestamp: parsed.timestamp || new Date().toISOString() });
      }
    } catch (e) {
      const num = Number(payload.toString());
      if (!isNaN(num)) buffer.push({ parameter: topic, value: num, timestamp: new Date().toISOString() });
    }
  });

  return {
    // MQTT is push-based, not poll-based — sample() just drains whatever
    // has arrived since the last call, rather than actively reading.
    sample: async () => { const out = buffer; buffer = []; return out; },
    close: async () => { client.end(); },
  };
}

// ── Main loop ────────────────────────────────────────────────
async function main() {
  const cfg = loadConfig();
  console.log('═══════════════════════════════════════════════════');
  console.log('  Corverxis IIoT Gateway Agent');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Mode:            ', cfg.mode);
  console.log('  Data Source ID:  ', cfg.dataSourceId);
  console.log('  API Base URL:    ', cfg.apiBaseUrl);
  console.log('  Push interval:   ', cfg.pushIntervalMs + 'ms');
  console.log('  Sample rate:     ', cfg.sampleHz + 'Hz');
  console.log('═══════════════════════════════════════════════════\n');

  let sampler;
  let closeFn = async () => {};

  if (cfg.mode === 'opcua') {
    const reader = await makeOpcuaReader(cfg);
    sampler = reader.sample;
    closeFn = reader.close;
  } else if (cfg.mode === 'modbus') {
    const reader = await makeModbusReader(cfg);
    sampler = reader.sample;
    closeFn = reader.close;
  } else if (cfg.mode === 'mqtt') {
    const reader = await makeMqttReader(cfg);
    sampler = reader.sample;
    closeFn = reader.close;
  } else {
    if (cfg.mode !== 'simulate') console.warn(`⚠ Unknown MODE "${cfg.mode}" — falling back to simulate.`);
    const sim = makeSimulator();
    sampler = async () => sim();
  }

  let buffer = [];
  const sampleIntervalMs = Math.max(200, Math.round(1000 / cfg.sampleHz));

  const sampleTimer = setInterval(async () => {
    try {
      const readings = await sampler();
      buffer.push(...readings);
    } catch (e) {
      console.error('⚠ Sample failed:', e.message);
    }
  }, sampleIntervalMs);

  const pushTimer = setInterval(async () => {
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    try {
      const result = await pushBatch(cfg, batch);
      console.log(`✓ Pushed ${batch.length} readings — total ingested: ${result.data?.totalIngested ?? '?'}`);
    } catch (e) {
      console.error(`✗ Push failed (${batch.length} readings lost from this batch):`, e.message);
    }
  }, cfg.pushIntervalMs);

  const shutdown = async () => {
    console.log('\nShutting down gateway agent...');
    clearInterval(sampleTimer);
    clearInterval(pushTimer);
    await closeFn();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});
