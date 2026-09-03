# Corverxis IIoT Gateway Agent

Runs **on-premises**, at the client's plant — on an edge gateway, an
industrial PC, or any small server that can reach both the local OT
network (to read sensors) and the internet (to push data to
CorverxisLab). It should **not** run in the cloud, and CorverxisLab
never reaches inward to the plant — the agent always initiates the
connection outward, so no inbound firewall rule is needed on the OT
network. This matches the OT/IT segmentation principle covered in the
Predictive Maintenance training course.

## Quick start (simulate mode — no hardware required)

```bash
cd gateway-agent
npm install
cp .env.example .env
# edit .env: set CORVERXIS_API_BASE_URL, CORVERXIS_DATA_SOURCE_ID, CORVERXIS_API_KEY
node agent.js
```

You'll see it generating realistic vibration/temperature/acoustic/current
readings and pushing batches every 30 seconds (configurable). Check the
data source's **Ingestion Events** tab in CorverxisLab to see them land.

## Getting your data source ID and API key

1. In CorverxisLab, go to **Site Onboarding** for the relevant pilot project
2. Click **+ Add Data Source**, choose type **IIoT Sensor**
3. The API key is shown **once**, immediately after creation — copy it
   then, it cannot be retrieved again (only its last 4 characters are
   ever shown afterward, for identification)
4. The data source ID is visible in the URL/detail view once created

If a key is lost, use **Regenerate Key** in the UI and update `.env` —
the old key stops working the moment a new one is generated.

## Connecting to real hardware

Most modern PLCs, SCADA historians, and IIoT gateways expose an
OPC-UA server:

```bash
npm install node-opcua
```
```
MODE=opcua
OPCUA_ENDPOINT_URL=opc.tcp://192.168.1.50:4840
OPCUA_NODE_IDS=ns=2;s=Line3.Spindle.Vibration,ns=2;s=Line3.Spindle.Temperature
```

Older plant equipment commonly exposes Modbus TCP instead:

```bash
npm install modbus-serial
```
```
MODE=modbus
MODBUS_HOST=192.168.1.60
MODBUS_PORT=502
MODBUS_UNIT_ID=1
MODBUS_REGISTERS=vibration:0:holding,temperature:2:holding
```

Or if the plant already publishes sensor data to an MQTT broker:

```bash
npm install mqtt
```
```
MODE=mqtt
MQTT_BROKER_URL=mqtt://192.168.1.70:1883
MQTT_TOPICS=plant/line3/vibration,plant/line3/temperature
```

Node IDs and register addresses are specific to your PLC/historian
configuration — your OT integrator or PLC vendor's documentation
will have the exact addresses. Each reader was verified against a
real local server/broker of its own protocol before shipping, not
just syntax-checked.

## Running as a persistent service

### systemd (Linux)
```ini
# /etc/systemd/system/corverxis-gateway.service
[Unit]
Description=Corverxis IIoT Gateway Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/corverxis-gateway-agent
EnvironmentFile=/opt/corverxis-gateway-agent/.env
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now corverxis-gateway
```

### pm2 (cross-platform)
```bash
npm install -g pm2
pm2 start agent.js --name corverxis-gateway
pm2 save
pm2 startup   # follow the printed instructions to survive reboots
```

## What happens if the network drops

Each push cycle sends whatever has been sampled since the last
successful push. If a push fails (network blip, key rotated, server
restart), that batch's readings are logged as lost and the agent
continues — it does **not** crash or stop sampling. For longer outages,
this means a gap in the data, not corrupted or duplicated data. A
future improvement worth building: local disk buffering so a
multi-hour outage doesn't lose data permanently, just delays it.

## Security notes

- The API key is scoped to **exactly one data source** — a compromised
  key only lets someone inject data into that one source, not access
  anything else in CorverxisONE.
- The key is stored on the server as a SHA-256 hash only — CorverxisLab
  itself cannot show you the raw key again after creation, and neither
  can anyone with database access.
- Keep `.env` out of version control (already covered by a
  `.gitignore` entry if you're using one) — treat the API key like a
  password.
