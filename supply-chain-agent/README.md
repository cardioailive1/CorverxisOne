# Corverxis Supply Chain Agent

Closes the "no on-prem agent equivalent" gap for Supply Chain. Unlike
the IIoT gateway agent, this is deliberately **poll-based, not
push-interval based** — a late-delivery notice or quality flag is a
discrete event, not a continuous stream, so there's nothing to sample
every second.

## Quick start (simulate mode)

```bash
cd supply-chain-agent
npm install
cp .env.example .env
# edit .env: set CORVERXIS_API_BASE_URL, CORVERXIS_DATA_SOURCE_ID, CORVERXIS_API_KEY
node agent.js
```

## Three modes

**`simulate`** — generates plausible test events against the two
starter suppliers seeded by org bootstrap. Good for validating the
pipeline before any real ERP integration exists.

**`webhook-poll`** — periodically `GET`s a REST endpoint you configure
(your client's ERP/procurement system), expecting a JSON array of
events or `{ "events": [...] }`. Set `WEBHOOK_URL` and, if the
endpoint needs auth, `WEBHOOK_AUTH_HEADER`.

**`file-watch`** — watches a local file for new lines, for ERPs that
only export flat files rather than exposing a modern API. Supports
JSON-lines (`WATCH_FILE_FORMAT=json`, one JSON object per line) or CSV
(`supplierName,event,severity,details`). Tracks a byte offset so only
genuinely new content is re-read each cycle, not the whole file.

## Event shape

Every mode ultimately produces the same shape, sent as `supplierEvents`
to the ingest endpoint:

```json
{ "supplierName": "Starter Alloy Supply Co.", "event": "LATE_DELIVERY", "severity": "MAJOR", "details": "..." }
```

`event` is `LATE_DELIVERY` or `QUALITY_ISSUE`. `severity` of `MAJOR`
or `CRITICAL` can automatically raise a Supplier Corrective Action
Report (SCAR) — see the platform's automation.js. **Supplier names
must match an existing Supplier record exactly** — an event for an
unrecognized name is skipped server-side, never used to fabricate a
new supplier.

## Running as a persistent service

Same pattern as the IIoT gateway agent — a systemd unit or `pm2` both
work:

```bash
npm install -g pm2
pm2 start agent.js --name corverxis-supply-chain
pm2 save && pm2 startup
```

## Security

Same model as the IIoT gateway agent: the API key is scoped to one
data source, stored server-side only as a SHA-256 hash, and shown to
you exactly once at creation.
