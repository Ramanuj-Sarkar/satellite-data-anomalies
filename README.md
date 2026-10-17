# Satellite Anomaly Detection Platform

Real-time satellite monitoring and anomaly detection platform. Retrieves orbital elements from CelesTrak's OMM catalog, propagates positions with SGP4, and visualizes ~289 satellites on an interactive 3D globe with live telemetry charts. Selecting a satellite — by clicking its dot on the globe or its name in the catalog list — highlights it everywhere: globe label, catalog highlight, and telemetry charts. Two data source modes: CelesTrak (real SGP4-propagated orbits) and Synthetic (same satellite catalog with noise and anomaly injection). Includes conjunction screening and a real-time anomaly detection engine.

## Architecture

```
 ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
 │  CelesTrak OMM API   │  │  Open Notify API     │  │  Synthetic Generator │
 │  (orbital elements)  │  │  (live ISS position) │  │  generate_iss_stream  │
 └──────────┬───────────┘  └──────────┬───────────┘  └──────────┬───────────┘
            │ HTTP (cached 2h)        │ HTTP poll               │ SQLite write
            ▼                         ▼                         ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                            FastAPI Backend                                  │
 │  - SGP4 orbit propagation (289+ satellites)                                │
 │  - three data source modes (celestrak / live / synthetic)                  │
 │  - anomaly detection engine                                                │
 │  - satellite catalog search (by name or NORAD ID)                          │
 │  - conjunction screening (spatial grid algorithm)                           │
 │  - WebSocket broadcast + REST API                                          │
 └────────────────────────────────┬────────────────────────────────────────────┘
                                  │ WebSocket + REST
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                           React Dashboard                                   │
 │  - interactive 3D globe (Three.js) — rotate, zoom, click satellites        │
 │  - source toggle (CelesTrak / Open Notify / Synthetic)                     │
 │  - satellite catalog search with live propagation                          │
 │  - conjunction screening alert panel                                       │
 │  - ground track scatter plot                                               │
 │  - latitude, longitude, altitude, velocity telemetry charts                │
 │  - real-time anomaly feed with severity                                    │
 └─────────────────────────────────────────────────────────────────────────────┘
```

### Data Sources

1. **CelesTrak mode (default)** — fetches OMM JSON catalogs from CelesTrak (stations, visual, weather, science groups — ~289 objects). Positions are propagated with SGP4 every 30 seconds. The catalog is cached for 2 hours.
2. **Open Notify mode** — polls `http://api.open-notify.org/iss-now.json` every 5 seconds for the ISS's lat/lon, enriched with simulated altitude and velocity.
3. **Synthetic mode** — `scripts/generate_iss_stream.py` models the ISS orbit (92.68 min period, 51.6 deg inclination) and writes readings to SQLite with configurable anomaly injection. The API reads new rows from the same database.

All modes feed the same anomaly detection engine. Switching sources clears accumulated state for a fresh view.

### Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn, httpx, sgp4 |
| Orbit propagation | SGP4 (Simplified General Perturbations 4) via CelesTrak OMM data |
| Frontend | React 19, Vite 8, Three.js, @react-three/fiber, @react-three/drei, Recharts |
| Database | SQLite (WAL mode for concurrent read/write) |
| Containerization | Docker, docker-compose, nginx reverse proxy |

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 22+
- (Optional) Docker & Docker Compose

### Local Development

**1. Start the API server:**

```bash
pip install -r api/requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8100
```

The API starts in **CelesTrak mode** by default — it fetches the satellite catalog on startup and begins propagating the ISS position with SGP4. No synthetic generator needed for this mode.

**2. Start the frontend:**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5174` in your browser. You'll see the 3D globe with satellite positions, catalog search, and conjunction screening.

**3. (Optional) Start the synthetic generator:**

```bash
python scripts/generate_iss_stream.py --interval 3 --anomaly-rate 0.15
```

Then switch to synthetic mode via the dashboard toggle or:

```bash
curl -X POST http://localhost:8100/api/source/synthetic
```

Generator flags:

| Flag | Default | Description |
|---|---|---|
| `--interval` | 3.0 | Seconds between readings |
| `--anomaly-rate` | 0.12 | Probability of triggering an anomaly per tick |
| `--max-readings` | None | Stop after N readings (runs forever if omitted) |
| `--db` | `data/satellite.db` | Database file path |
| `--stdout` | off | Also print JSON to stdout |
| `--seed` | None | Random seed for reproducibility |

### Docker (Production)

```bash
docker compose up --build
```

Starts all three services (generator, API, frontend with nginx). First build required; rebuild after code changes.

- API: `http://localhost:8100`
- Dashboard: `http://localhost:3100`

### Docker (Development — Hot Reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

Same ports, but source code is mounted as volumes so changes are picked up automatically — no rebuild needed:

- **API** — uvicorn runs with `--reload`, watches `api/main.py` and `api/catalog.py`
- **Frontend** — Vite dev server with HMR, watches `frontend/src/`
- **Generator** — script file is mounted in; restart the container to pick up changes (`docker compose -f docker-compose.dev.yml restart generator`)

## Features

### Real Orbital Elements

The app retrieves CelesTrak's OMM JSON catalog and propagates positions with SGP4. The positions refresh every 30 seconds, while the source catalog is cached for two hours. The catalog includes stations, visual satellites, weather satellites, and science missions (~289 objects).

### Interactive 3D Visualization

Rotate the Earth, zoom in, and select satellite markers to inspect their calculated altitude and speed. The 3D globe renders all catalog satellites as interactive points — cyan for normal, magenta when selected. The ISS orbit trail is drawn as a continuous path. Built with Three.js via react-three-fiber.

### Satellite Catalog and Conjunction Screening

Search objects by name or NORAD ID and view their real-time propagated positions (latitude, longitude, altitude, velocity). The screening panel identifies candidate close approaches using a spatial grid algorithm that avoids O(n^2) pairwise distance checks. Close approaches are color-coded by severity: red (<5 km), orange (<15 km), cyan (>15 km).

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
| GET | `/api/status` | System status, reading count, anomaly counts, catalog size |
| GET | `/api/positions?limit=100` | Recent position history |
| GET | `/api/anomalies?limit=50` | Recent detected anomalies |
| GET | `/api/source` | Current data source mode |
| POST | `/api/source/{mode}` | Switch data source (`celestrak`, `live`, or `synthetic`) |
| GET | `/api/catalog/search?q=ISS` | Search catalog by name or NORAD ID |
| GET | `/api/catalog/stats` | Catalog size, last fetch time, staleness |
| GET | `/api/catalog/propagate?norad_id=25544` | Propagate a single satellite to current time |
| GET | `/api/catalog/positions?limit=300` | Propagate all catalog satellites |
| GET | `/api/screening?threshold_km=50` | Find close approaches within threshold |
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
    "source": "celestrak",
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
    "source": "celestrak",
    "catalog_size": 289
  }
}
```

## Project Structure

```
satellite-data-anomalies/
├── api/
│   ├── main.py              # FastAPI app, anomaly detection, WebSocket
│   ├── catalog.py           # CelesTrak catalog, SGP4 propagation, screening
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.jsx      # Main dashboard layout
│   │   │   ├── Globe.jsx          # Interactive 3D Earth + satellite markers
│   │   │   ├── CatalogSearch.jsx  # Satellite search by name/NORAD ID
│   │   │   └── ScreeningPanel.jsx # Conjunction screening alerts
│   │   ├── hooks/
│   │   │   └── useSatelliteStream.js  # WebSocket + REST + catalog client
│   │   ├── index.css         # Space-themed styles
│   │   ├── main.jsx
│   │   └── App.jsx
│   ├── nginx.conf
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
├── scripts/
│   ├── generate_iss_stream.py  # Synthetic ISS telemetry generator
│   └── Dockerfile
├── data/
│   └── satellite.db            # SQLite (gitignored)
├── docker-compose.yml          # Production (nginx + built assets)
├── docker-compose.dev.yml      # Development (hot reload)
└── README.md
```

## Glossary

| Term | Definition |
|---|---|
| **Altitude (orbital)** | Height above Earth's surface. The ISS orbits at approximately 408 km in Low Earth Orbit (LEO). Valid LEO range is roughly 100-1000 km. |
| **Anomaly** | A data point that deviates significantly from expected behavior — either physically impossible values, unexpected position changes, or stale telemetry. |
| **CelesTrak** | A website and data service that distributes satellite orbital element sets (TLEs and OMM data) from NORAD/18th Space Defense Squadron. The primary source for publicly available satellite tracking data. |
| **Comm gap** | A period when the ISS cannot communicate with ground stations because it is not in line-of-sight with a TDRS relay satellite. |
| **Conjunction** | A close approach between two orbiting objects. Conjunction screening identifies pairs of satellites that pass within a given distance threshold, flagging potential collision risks. |
| **Data injection** | An adversarial attack where a threat actor inserts fabricated telemetry into the data stream to mislead monitoring systems or mask the satellite's true state. |
| **Ground track** | The path traced on Earth's surface directly below the satellite as it orbits. The ISS ground track appears as a sinusoidal wave due to its inclined orbit combined with Earth's rotation. |
| **Inclination** | The angle between the orbital plane and Earth's equator. The ISS has a 51.6-degree inclination, meaning it never passes farther north or south than 51.6 degrees latitude. |
| **ISS** | International Space Station. A modular space station in low Earth orbit, jointly operated by NASA, Roscosmos, JAXA, ESA, and CSA. |
| **LEO** | Low Earth Orbit. Orbits with altitudes between roughly 160 km and 2,000 km. The ISS operates in LEO. |
| **NORAD ID** | A sequential catalog number assigned to every tracked space object by the North American Aerospace Defense Command. The ISS is NORAD 25544. |
| **OMM** | Orbital Mean-elements Message. A modern JSON/XML format for distributing satellite orbital elements, replacing the legacy two-line element (TLE) format. Used by CelesTrak's GP (General Perturbations) API. |
| **Open Notify API** | A free public API (`api.open-notify.org`) that provides the current position of the ISS in real time, returning latitude and longitude as JSON. |
| **Orbital deviation** | An unexpected change in the satellite's position relative to its predicted orbital path. May be caused by planned maneuvers, gravitational perturbation, or spoofed data. |
| **Orbital period** | The time it takes a satellite to complete one full orbit. The ISS completes one orbit approximately every 92.68 minutes, circling Earth about 15.5 times per day. |
| **Orbital velocity** | The speed at which a satellite travels along its orbit. The ISS moves at approximately 7.66 km/s (27,600 km/h or 17,150 mph). |
| **Reboost** | A planned maneuver to raise the ISS's orbit, counteracting gradual altitude decay from atmospheric drag. Uses thrusters from docked spacecraft. |
| **SGP4** | Simplified General Perturbations 4. The standard analytical orbit propagation model used by NORAD and the space surveillance community. Given a set of orbital elements (from a TLE or OMM record), SGP4 predicts a satellite's position and velocity at any future time, accounting for Earth's oblateness, atmospheric drag, and lunar/solar gravitational effects. |
| **Stale data** | Telemetry readings that repeat the same values across multiple polling intervals, indicating a communication failure rather than genuine position data. |
| **TDRS** | Tracking and Data Relay Satellite System. A constellation of NASA communication satellites in geostationary orbit that relay signals between the ISS and ground stations. |
| **Telemetry** | Data transmitted from a remote source (the satellite) to a receiving station for monitoring. Includes position, altitude, velocity, and system health metrics. |
| **TEME** | True Equator Mean Equinox. The coordinate frame used by SGP4 for satellite position and velocity output. Positions must be rotated by GMST (Greenwich Mean Sidereal Time) to convert to Earth-fixed (ECEF) coordinates for latitude/longitude. |
| **TLE** | Two-Line Element set. The legacy fixed-width text format for satellite orbital elements, being superseded by OMM (JSON/XML). Contains the same orbital parameters used by SGP4. |
| **WAL mode** | Write-Ahead Logging. A SQLite journaling mode that allows concurrent readers and a single writer without blocking, used here so the generator and API can access the database simultaneously. |

## Why This Matters

Every six seconds, the International Space Station crosses 46 kilometers of orbital arc at 7.66 km/s. Ground controllers at Mission Control Houston, Moscow's TsUP, and partner agencies around the world depend on continuous, trustworthy telemetry to keep the station — and the astronauts aboard — safe.

**The trust problem.** Satellite telemetry systems were designed in an era when the data link was assumed to be reliable and uncontested. That assumption is increasingly fragile:

- **GPS spoofing** — nation-state and criminal actors have demonstrated the ability to feed false GPS signals to aircraft and maritime vessels. The same technique applied to space assets could mask an orbital anomaly or fabricate a collision warning.
- **Ground station compromise** — telemetry relay infrastructure passes through terrestrial networks. A compromised ground station or TDRS uplink could inject fabricated position data indistinguishable from genuine readings.
- **Signal jamming** — deliberate interference with S-band or Ku-band communication channels can create artificial connectivity losses, blinding ground controllers during critical operations like docking, reboost, or debris avoidance maneuvers.

**What this platform demonstrates:**

1. **Real orbital mechanics.** SGP4 propagation from authoritative CelesTrak data means the positions on the globe and in the charts are physically accurate — not simulated approximations. The same algorithm used by NORAD for space surveillance.

2. **Anomaly detection as a security layer.** By modeling expected orbital mechanics and flagging deviations in real time, the system catches not just natural telemetry faults but adversarial manipulation — data injection attacks produce physically impossible coordinates or trajectory discontinuities that betray the fabrication.

3. **Conjunction awareness.** The screening algorithm identifies satellites passing dangerously close to each other — the same class of problem that generates conjunction data messages (CDMs) in operational space surveillance. With ~30,000 tracked objects and growing, automated screening is essential.

4. **Dual-source validation.** The toggle between real catalog data and a synthetic generator with known anomaly injection provides a controlled environment to tune detection thresholds — the same approach used in satellite operations to validate ground software against simulated failure scenarios before trusting it with real missions.

5. **Continuous monitoring at machine speed.** A human operator watching a telemetry console might catch a sudden position jump. They will not catch a slow, deliberate drift designed to gradually shift the perceived orbit by 0.1 degrees per reading. Automated threshold-based detection runs on every single data point, at every polling interval, without fatigue.

The ISS is the most visible example, but this pattern — streaming telemetry, physics-based anomaly detection, conjunction screening, adversarial threat modeling — applies to the entire growing constellation of LEO assets: Earth observation satellites, communications networks, and the orbital debris tracking systems that keep all of them from colliding.
