#!/usr/bin/env node
/**
 * Corverxis Supply Chain Agent
 * ==================================================
 * Unlike the IIoT gateway agent, supplier events are business data,
 * not a continuous sensor stream — a late-delivery notice or a
 * quality-issue flag arrives as a discrete event, not a value every
 * second. This agent is deliberately POLL-based, not push-interval
 * based, and supports three sources for those events:
 *
 *   MODE=simulate      → generates plausible test events, no real
 *                         ERP connection required
 *   MODE=webhook-poll   → periodically GETs a configured REST endpoint
 *                         (an ERP/procurement system's API) expecting
 *                         a JSON array of events
 *   MODE=file-watch     → watches a local CSV/JSON file for new rows —
 *                         common when the client's ERP only exports
 *                         flat files, not a modern REST API
 *
 * In every mode, events are matched against real supplier names
 * already in CorverxisONE — an event for an unrecognized supplier
 * is skipped server-side, never fabricated into a new record.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env   # fill in your values
 *   node agent.js
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
    apiBaseUrl:      env.CORVERXIS_API_BASE_URL   || fileConfig.apiBaseUrl   || 'https://your-corverxis-deployment.onrender.com',
    dataSourceId:    env.CORVERXIS_DATA_SOURCE_ID || fileConfig.dataSourceId,
    apiKey:          env.CORVERXIS_API_KEY        || fileConfig.apiKey,
    mode:            (env.MODE                     || fileConfig.mode || 'simulate').toLowerCase(),
    pollIntervalMs:  Number(env.POLL_INTERVAL_MS  || fileConfig.pollIntervalMs || 3600000), // default: hourly — supplier events are low-frequency
    // webhook-poll specific
    webhookUrl:      env.WEBHOOK_URL              || fileConfig.webhookUrl,
    webhookAuthHeader: env.WEBHOOK_AUTH_HEADER     || fileConfig.webhookAuthHeader, // e.g. "Bearer xyz" — sent as-is to the client's ERP endpoint
    // file-watch specific
    watchFilePath:   env.WATCH_FILE_PATH          || fileConfig.watchFilePath,
    watchFileFormat: (env.WATCH_FILE_FORMAT       || fileConfig.watchFileFormat || 'json').toLowerCase(), // json or csv
  };
  if (!cfg.dataSourceId || !cfg.apiKey) {
    console.error('❌ Missing required config: CORVERXIS_DATA_SOURCE_ID and CORVERXIS_API_KEY must be set.');
    console.error('   Get these from any ERP or API_FEED-type data source created in CorverxisLab — the API key is shown once at creation.');
    process.exit(1);
  }
  return cfg;
}

// ── HTTPS push to CorverxisLab ─────────────────────────────────
function pushEvents(cfg, supplierEvents) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/v1/lab/data-sources/${cfg.dataSourceId}/ingest`, cfg.apiBaseUrl);
    const body = JSON.stringify({ supplierEvents });
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${cfg.apiKey}` },
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

// ── Simulate mode ────────────────────────────────────────────
// Deliberately mundane — real supplier events are rare and specific,
// not a constant stream, so this fires a small, realistic batch each
// poll rather than pretending every cycle brings a fresh crisis.
const SIM_SUPPLIERS = ['Starter Alloy Supply Co.', 'Starter Precision Tooling Ltd.'];
const SIM_EVENTS = [
  { event: 'LATE_DELIVERY', severity: 'MAJOR', details: 'Shipment delayed 3 business days — carrier capacity issue' },
  { event: 'QUALITY_ISSUE', severity: 'CRITICAL', details: 'Incoming inspection failed — dimensional out of tolerance on 2 of 20 sampled parts' },
  { event: 'LATE_DELIVERY', severity: 'MINOR', details: 'Shipment 1 day behind original ETA' },
];
function simulateEvents() {
  // Roughly one event per poll cycle, not a flood — matches how
  // infrequently a real supplier issue actually gets flagged.
  if (Math.random() < 0.4) return [];
  const supplier = SIM_SUPPLIERS[Math.floor(Math.random() * SIM_SUPPLIERS.length)];
  const template = SIM_EVENTS[Math.floor(Math.random() * SIM_EVENTS.length)];
  return [{ supplierName: supplier, ...template }];
}

// ── Webhook-poll mode ────────────────────────────────────────
function fetchWebhookEvents(cfg) {
  return new Promise((resolve, reject) => {
    if (!cfg.webhookUrl) return reject(new Error('MODE=webhook-poll requires WEBHOOK_URL to be set.'));
    const url = new URL(cfg.webhookUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const headers = {};
    if (cfg.webhookAuthHeader) headers['Authorization'] = cfg.webhookAuthHeader;
    const req = lib.request(url, { method: 'GET', headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) ? parsed : (parsed.events || []));
          } catch (e) { reject(new Error('Webhook response was not valid JSON: ' + e.message)); }
        } else {
          reject(new Error(`Webhook fetch failed (${res.statusCode}): ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Webhook request timed out')));
    req.on('error', reject);
    req.end();
  });
}

// ── File-watch mode ──────────────────────────────────────────
// Tracks a byte offset so a growing log-style file only has its NEW
// content re-read each poll, not the whole file every time.
let fileOffset = 0;
function readNewFileContent(cfg) {
  if (!cfg.watchFilePath) throw new Error('MODE=file-watch requires WATCH_FILE_PATH to be set.');
  if (!fs.existsSync(cfg.watchFilePath)) return [];
  const stat = fs.statSync(cfg.watchFilePath);
  if (stat.size <= fileOffset) return []; // no new content, or file was truncated/rotated
  const fd = fs.openSync(cfg.watchFilePath, 'r');
  const buffer = Buffer.alloc(stat.size - fileOffset);
  fs.readSync(fd, buffer, 0, buffer.length, fileOffset);
  fs.closeSync(fd);
  fileOffset = stat.size;
  const newContent = buffer.toString('utf8');

  if (cfg.watchFileFormat === 'csv') {
    return newContent.split('\n').filter(Boolean).map((line) => {
      const [supplierName, event, severity, details] = line.split(',').map((s) => s.trim());
      return { supplierName, event, severity, details };
    });
  }
  // JSON lines format — one JSON object per line, the common pattern
  // for append-only export files
  return newContent.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// ── Main loop ────────────────────────────────────────────────
async function poll(cfg) {
  let events = [];
  try {
    if (cfg.mode === 'webhook-poll') events = await fetchWebhookEvents(cfg);
    else if (cfg.mode === 'file-watch') events = readNewFileContent(cfg);
    else events = simulateEvents();
  } catch (e) {
    console.error('⚠ Failed to gather events this cycle:', e.message);
    return;
  }

  if (!events.length) {
    console.log(`[${new Date().toISOString()}] No new supplier events this cycle.`);
    return;
  }

  try {
    const result = await pushEvents(cfg, events);
    console.log(`✓ Pushed ${events.length} event(s) — matched: ${result.data?.matched ?? '?'}, SCARs raised: ${result.data?.scarsRaised?.length ?? 0}`);
  } catch (e) {
    console.error(`✗ Push failed (${events.length} event(s) not delivered this cycle):`, e.message);
  }
}

async function main() {
  const cfg = loadConfig();
  console.log('═══════════════════════════════════════════════════');
  console.log('  Corverxis Supply Chain Agent');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Mode:            ', cfg.mode);
  console.log('  Data Source ID:  ', cfg.dataSourceId);
  console.log('  API Base URL:    ', cfg.apiBaseUrl);
  console.log('  Poll interval:   ', cfg.pollIntervalMs + 'ms');
  console.log('═══════════════════════════════════════════════════\n');

  await poll(cfg); // run once immediately, then on the interval
  const timer = setInterval(() => poll(cfg), cfg.pollIntervalMs);

  const shutdown = () => { console.log('\nShutting down Supply Chain agent...'); clearInterval(timer); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error('❌ Fatal error:', e.message); process.exit(1); });
