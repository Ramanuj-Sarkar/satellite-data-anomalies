# Satellite Anomaly Detection Platform

Real-time ISS telemetry monitoring and anomaly detection. Polls the International Space Station's live position from the Open Notify API — or reads from a synthetic data generator that simulates orbital mechanics and injects anomalies — and surfaces deviations through a live dashboard with ground track visualization, telemetry charts, and an anomaly feed.

## Architecture

```
 ┌──────────────────────┐      ┌──────────────────────┐
 │  Open Notify API     │      │  Synthetic Generator  │
 │  (live ISS position) │      │  generate_iss_stream   │
 └──────────┬───────────┘      └──────────┬────────────┘
            │ HTTP poll                    │ SQLite write
            ▼                             ▼
 ┌─────────────────────────────────────────────────────┐
 │                   FastAPI Backend                    │
 │  - dual data source (live / synthetic)              │
 │  - anomaly detection engine                         │
 │  - WebSocket broadcast                              │
 │  - REST API                                         │
 └───────────────────────┬─────────────────────────────┘
                         │ WebSocket + REST
                         ▼
 ┌─────────────────────────────────────────────────────┐
 │                React Dashboard                       │
 │  - source toggle (Live / Synthetic)                 │
 │  - ground track scatter plot                        │
 │  - latitude, longitude, altitude, velocity charts   │
 │  - real-time anomaly feed with severity             │
 └─────────────────────────────────────────────────────┘
```

### Data Flow

1. **Live mode** — the API polls `http://api.open-notify.org/iss-now.json` every 5 seconds for the ISS's current latitude and longitude, enriches with simulated altitude and velocity.
2. **Synthetic mode** — `scripts/generate_iss_stream.py` models the ISS orbit (92.68 min period, 51.6 deg inclination) and writes readings to SQLite with configurable anomaly injection. The API reads new rows from the same database.
3. The anomaly detection engine evaluates each reading against orbital physics thresholds and flags deviations.
4. Readings and detected anomalies are broadcast to all connected dashboard clients via WebSocket.

### Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn, httpx |
| Frontend | React 19, Vite 8, Recharts |
| Database | SQLite (WAL mode for concurrent read/write) |
| Containerization | Docker, docker-compose, nginx reverse proxy |

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 22+
- (Optional) Docker & Docker Compose

### Local Development

**1. Start the synthetic data generator:**

```bash
python scripts/generate_iss_stream.py --interval 3 --anomaly-rate 0.15
```

This writes ISS telemetry readings to `data/satellite.db` every 3 seconds, with a 15% chance of anomaly injection per tick.

Generator flags:

| Flag | Default | Description |
|---|---|---|
| `--interval` | 3.0 | Seconds between readings |
| `--anomaly-rate` | 0.12 | Probability of triggering an anomaly per tick |
| `--max-readings` | None | Stop after N readings (runs forever if omitted) |
| `--db` | `data/satellite.db` | Database file path |
| `--stdout` | off | Also print JSON to stdout |
| `--seed` | None | Random seed for reproducibility |

**2. Start the API server:**

```bash
pip install -r api/requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8100
```

The API starts in **live mode** by default (polling Open Notify). Switch to synthetic via the dashboard toggle or:

```bash
curl -X POST http://localhost:8100/api/source/synthetic
```

**3. Start the frontend:**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5174` in your browser.

### Docker

```bash
docker compose up --build
```

- API: `http://localhost:8100`
- Dashboard: `http://localhost:3100`

Note: in Docker mode, run the synthetic generator on the host and mount the `data/` volume, or start the generator inside the API container.

## Anomaly Detection

The detection engine evaluates each incoming position reading against three categories:

### Impossible Coordinates (Critical)

Values outside physically valid ranges or sudden teleportation events:

- Latitude outside +/- 90 degrees
- Longitude outside +/- 180 degrees
- Altitude outside 100-1000 km (LEO range)
- Orbital velocity outside 5-10 km/s

This pattern is consistent with **adversarial data injection** — a threat actor feeding bogus telemetry to corrupt downstream systems or mask the satellite's true position.

### Orbital Deviation (Warning / Critical)

The ISS position has drifted significantly from its predicted orbital path. The engine computes expected angular displacement based on ISS speed (~7.66 km/s) and time delta, then flags readings where the actual position jump exceeds 1.5x the expected maximum. Deviations greater than 3x are escalated to critical severity.

Causes: unscheduled reboost maneuver, gravitational perturbation, or spoofed GPS/telemetry data.

### Connectivity Loss (Warning)

Telemetry data is stale — the same coordinates are being repeated across consecutive readings, indicating a communication blackout. The ISS experiences periodic comm gaps when not in line-of-sight with TDRS relay satellites. Prolonged gaps may indicate jamming or signal interference.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | System status, reading count, anomaly counts by type |
| GET | `/api/positions?limit=100` | Recent position history |
| GET | `/api/anomalies?limit=50` | Recent detected anomalies |
| GET | `/api/source` | Current data source mode |
| POST | `/api/source/{mode}` | Switch data source (`live` or `synthetic`) |
| WS | `/ws` | Real-time position updates and anomaly alerts |

### WebSocket Message Format

```json
{
  "type": "position_update",
  "reading": {
    "id": "uuid",
    "timestamp": 1700000000,
    "latitude": 42.3601,
    "longitude": -71.0589,
    "altitude_km": 408.3,
    "velocity_km_s": 7.662,
    "source": "live",
    "anomaly": null
  },
  "anomalies": [],
  "stats": {
    "total_readings": 150,
    "total_anomalies": 12,
    "anomalies_by_type": {
      "orbital_deviation": 5,
      "connectivity_loss": 4,
      "impossible_coords": 3
    },
    "source": "live"
  }
}
```

## Project Structure

```
satellite-data-anomalies/
├── api/
│   ├── main.py              # FastAPI app, anomaly detection, WebSocket
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Dashboard.jsx # Ground track, telemetry charts, anomaly feed
│   │   ├── hooks/
│   │   │   └── useSatelliteStream.js  # WebSocket + REST client
│   │   ├── index.css         # Space-themed styles
│   │   ├── main.jsx
│   │   └── App.jsx
│   ├── nginx.conf
│   ├── Dockerfile
│   └── package.json
├── scripts/
│   └── generate_iss_stream.py  # Synthetic ISS telemetry generator
├── data/
│   └── satellite.db            # SQLite (gitignored)
├── docker-compose.yml
└── README.md
```

## Glossary

| Term | Definition |
|---|---|
| **Altitude (orbital)** | Height above Earth's surface. The ISS orbits at approximately 408 km in Low Earth Orbit (LEO). Valid LEO range is roughly 100-1000 km. |
| **Anomaly** | A data point that deviates significantly from expected behavior — either physically impossible values, unexpected position changes, or stale telemetry. |
| **Comm gap** | A period when the ISS cannot communicate with ground stations because it is not in line-of-sight with a TDRS relay satellite. |
| **Data injection** | An adversarial attack where a threat actor inserts fabricated telemetry into the data stream to mislead monitoring systems or mask the satellite's true state. |
| **Ground track** | The path traced on Earth's surface directly below the satellite as it orbits. The ISS ground track appears as a sinusoidal wave due to its inclined orbit combined with Earth's rotation. |
| **Inclination** | The angle between the orbital plane and Earth's equator. The ISS has a 51.6-degree inclination, meaning it never passes farther north or south than 51.6 degrees latitude. |
| **ISS** | International Space Station. A modular space station in low Earth orbit, jointly operated by NASA, Roscosmos, JAXA, ESA, and CSA. |
| **LEO** | Low Earth Orbit. Orbits with altitudes between roughly 160 km and 2,000 km. The ISS operates in LEO. |
| **Open Notify API** | A free public API (`api.open-notify.org`) that provides the current position of the ISS in real time, returning latitude and longitude as JSON. |
| **Orbital deviation** | An unexpected change in the satellite's position relative to its predicted orbital path. May be caused by planned maneuvers, gravitational perturbation, or spoofed data. |
| **Orbital period** | The time it takes a satellite to complete one full orbit. The ISS completes one orbit approximately every 92.68 minutes, circling Earth about 15.5 times per day. |
| **Orbital velocity** | The speed at which a satellite travels along its orbit. The ISS moves at approximately 7.66 km/s (27,600 km/h or 17,150 mph). |
| **Reboost** | A planned maneuver to raise the ISS's orbit, counteracting gradual altitude decay from atmospheric drag. Uses thrusters from docked spacecraft. |
| **Stale data** | Telemetry readings that repeat the same values across multiple polling intervals, indicating a communication failure rather than genuine position data. |
| **TDRS** | Tracking and Data Relay Satellite System. A constellation of NASA communication satellites in geostationary orbit that relay signals between the ISS and ground stations. |
| **Telemetry** | Data transmitted from a remote source (the satellite) to a receiving station for monitoring. Includes position, altitude, velocity, and system health metrics. |
| **WAL mode** | Write-Ahead Logging. A SQLite journaling mode that allows concurrent readers and a single writer without blocking, used here so the generator and API can access the database simultaneously. |

## Why This Matters

Every six seconds, the International Space Station crosses 46 kilometers of orbital arc at 7.66 km/s. Ground controllers at Mission Control Houston, Moscow's TsUP, and partner agencies around the world depend on continuous, trustworthy telemetry to keep the station — and the astronauts aboard — safe.

**The trust problem.** Satellite telemetry systems were designed in an era when the data link was assumed to be reliable and uncontested. That assumption is increasingly fragile:

- **GPS spoofing** — nation-state and criminal actors have demonstrated the ability to feed false GPS signals to aircraft and maritime vessels. The same technique applied to space assets could mask an orbital anomaly or fabricate a collision warning.
- **Ground station compromise** — telemetry relay infrastructure passes through terrestrial networks. A compromised ground station or TDRS uplink could inject fabricated position data indistinguishable from genuine readings.
- **Signal jamming** — deliberate interference with S-band or Ku-band communication channels can create artificial connectivity losses, blinding ground controllers during critical operations like docking, reboost, or debris avoidance maneuvers.

**What this platform demonstrates:**

1. **Anomaly detection as a security layer.** By modeling expected orbital mechanics and flagging deviations in real time, the system catches not just natural telemetry faults but adversarial manipulation — data injection attacks produce physically impossible coordinates or trajectory discontinuities that betray the fabrication.

2. **Dual-source validation.** The toggle between live API data and a synthetic generator with known anomaly injection provides a controlled environment to tune detection thresholds — the same approach used in satellite operations to validate ground software against simulated failure scenarios before trusting it with real missions.

3. **Continuous monitoring at machine speed.** A human operator watching a telemetry console might catch a sudden position jump. They will not catch a slow, deliberate drift designed to gradually shift the perceived orbit by 0.1 degrees per reading. Automated threshold-based detection runs on every single data point, at every polling interval, without fatigue.

The ISS is the most visible example, but this pattern — streaming telemetry, physics-based anomaly detection, adversarial threat modeling — applies to the entire growing constellation of LEO assets: Earth observation satellites, communications networks, and the orbital debris tracking systems that keep all of them from colliding.
