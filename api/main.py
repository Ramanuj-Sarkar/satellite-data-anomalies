"""Satellite anomaly detection API.

Polls the Open Notify ISS API (or reads from the synthetic generator's
SQLite database) for position data, runs anomaly detection, and pushes
real-time updates to the React dashboard via WebSocket.
"""

from __future__ import annotations

import asyncio
import math
import os
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

DB_PATH = os.environ.get(
    "SATELLITE_DB_PATH",
    str(Path(__file__).resolve().parent.parent / "data" / "satellite.db"),
)

# ---------------------------------------------------------------------------
# ISS orbital constants for anomaly detection
# ---------------------------------------------------------------------------

ISS_ORBITAL_PERIOD = 92.68 * 60
ISS_INCLINATION = 51.6
ISS_SPEED_KM_S = 7.66
ISS_ALTITUDE_KM = 408.0
MAX_SPEED_DEVIATION = 1.0
MAX_POSITION_JUMP_DEG = 5.0
STALE_THRESHOLD_S = 15

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

position_history: list[dict] = []
anomaly_log: list[dict] = []
stats: dict[str, Any] = {
    "total_readings": 0,
    "total_anomalies": 0,
    "anomalies_by_type": {"orbital_deviation": 0, "connectivity_loss": 0, "impossible_coords": 0},
    "source": "live",
    "uptime_start": 0,
}
data_source: dict[str, str] = {"mode": "live"}  # "live" or "synthetic"

MAX_HISTORY = 500
MAX_ANOMALY_LOG = 200
POLL_INTERVAL = 5.0

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

last_seen_db_ts: dict[str, int] = {"ts": 0}


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS iss_positions (
            id              TEXT PRIMARY KEY,
            timestamp       INTEGER NOT NULL,
            latitude        REAL NOT NULL,
            longitude       REAL NOT NULL,
            altitude_km     REAL NOT NULL,
            velocity_km_s   REAL NOT NULL,
            source          TEXT NOT NULL DEFAULT 'live',
            anomaly         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_iss_ts ON iss_positions(timestamp DESC);
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------

ANOMALY_DESCRIPTIONS = {
    "orbital_deviation": (
        "Orbital trajectory deviation detected. The ISS position has drifted "
        "significantly from its predicted orbital path. This may indicate an "
        "unscheduled reboost maneuver, gravitational perturbation, or — in an "
        "adversarial scenario — spoofed GPS/telemetry data."
    ),
    "connectivity_loss": (
        "Telemetry connectivity loss detected. Position data is stale — the same "
        "coordinates are being repeated, indicating a communication blackout. "
        "The ISS experiences periodic comm gaps when not in line-of-sight with "
        "TDRS relay satellites. Prolonged gaps may indicate jamming or interference."
    ),
    "impossible_coords": (
        "Impossible coordinates detected — values outside physically valid ranges "
        "or a sudden teleportation event. Latitude must be within +/-90 degrees, "
        "longitude within +/-180 degrees, and altitude consistent with LEO orbit. "
        "This pattern is consistent with adversarial data injection — a threat actor "
        "feeding bogus telemetry to corrupt downstream systems, mislead ground "
        "controllers, or mask the satellite's true position."
    ),
}


def detect_anomalies(reading: dict, history: list[dict]) -> list[dict]:
    anomalies = []
    lat = reading["latitude"]
    lon = reading["longitude"]
    alt = reading["altitude_km"]
    vel = reading["velocity_km_s"]
    ts = reading["timestamp"]

    # 1. Impossible coordinates
    reasons = []
    if abs(lat) > 90:
        reasons.append(f"latitude {lat}° outside +/-90° range")
    if abs(lon) > 180:
        reasons.append(f"longitude {lon}° outside +/-180° range")
    if alt < 100 or alt > 1000:
        reasons.append(f"altitude {alt} km outside LEO range (100-1000 km)")
    if vel < 5.0 or vel > 10.0:
        reasons.append(f"velocity {vel} km/s outside orbital range (5-10 km/s)")

    if reasons:
        anomalies.append({
            "id": str(uuid.uuid4()),
            "type": "impossible_coords",
            "severity": "critical",
            "timestamp": ts,
            "description": ANOMALY_DESCRIPTIONS["impossible_coords"],
            "details": "; ".join(reasons),
            "reading_id": reading["id"],
            "latitude": lat,
            "longitude": lon,
        })

    # 2. Connectivity loss (stale data)
    if len(history) >= 2:
        prev = history[-1]
        if prev["timestamp"] == ts or (prev["latitude"] == lat and prev["longitude"] == lon):
            anomalies.append({
                "id": str(uuid.uuid4()),
                "type": "connectivity_loss",
                "severity": "warning",
                "timestamp": ts,
                "description": ANOMALY_DESCRIPTIONS["connectivity_loss"],
                "details": f"Position identical to previous reading at {prev['timestamp']}",
                "reading_id": reading["id"],
                "latitude": lat,
                "longitude": lon,
            })

    # 3. Orbital deviation (position jump)
    if len(history) >= 2:
        prev = history[-1]
        dt = ts - prev["timestamp"]
        if dt > 0:
            dlat = abs(lat - prev["latitude"])
            dlon = abs(lon - prev["longitude"])
            expected_deg_per_sec = (ISS_SPEED_KM_S / (EARTH_RADIUS_KM * math.pi / 180))
            max_expected = expected_deg_per_sec * dt * 1.5

            if dlat > max_expected or dlon > max_expected:
                anomalies.append({
                    "id": str(uuid.uuid4()),
                    "type": "orbital_deviation",
                    "severity": "critical" if (dlat > max_expected * 3 or dlon > max_expected * 3) else "warning",
                    "timestamp": ts,
                    "description": ANOMALY_DESCRIPTIONS["orbital_deviation"],
                    "details": f"Position jumped {dlat:.2f}° lat, {dlon:.2f}° lon in {dt}s (max expected: {max_expected:.2f}°)",
                    "reading_id": reading["id"],
                    "latitude": lat,
                    "longitude": lon,
                })

    return anomalies


EARTH_RADIUS_KM = 6371.0


# ---------------------------------------------------------------------------
# WebSocket manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self) -> None:
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, message: dict) -> None:
        dead = []
        for ws in self.connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self.connections:
                self.connections.remove(ws)


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Data polling
# ---------------------------------------------------------------------------

async def fetch_live_position() -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("http://api.open-notify.org/iss-now.json")
            resp.raise_for_status()
            data = resp.json()

            if data.get("message") != "success":
                return None

            return {
                "id": str(uuid.uuid4()),
                "timestamp": data["timestamp"],
                "latitude": float(data["iss_position"]["latitude"]),
                "longitude": float(data["iss_position"]["longitude"]),
                "altitude_km": ISS_ALTITUDE_KM + (hash(data["timestamp"]) % 100 - 50) * 0.1,
                "velocity_km_s": ISS_SPEED_KM_S + (hash(data["timestamp"] + 1) % 100 - 50) * 0.004,
                "source": "live",
                "anomaly": None,
            }
    except Exception:
        return None


def fetch_synthetic_positions() -> list[dict]:
    try:
        conn = get_db()
        ts = last_seen_db_ts["ts"]
        rows = conn.execute(
            "SELECT * FROM iss_positions WHERE timestamp > ? ORDER BY timestamp ASC LIMIT 50",
            (ts,),
        ).fetchall()
        conn.close()

        results = []
        for row in rows:
            results.append({
                "id": row["id"],
                "timestamp": row["timestamp"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "altitude_km": row["altitude_km"],
                "velocity_km_s": row["velocity_km_s"],
                "source": row["source"],
                "anomaly": row["anomaly"],
            })
            last_seen_db_ts["ts"] = row["timestamp"]

        return results
    except Exception:
        return []


async def process_reading(reading: dict) -> None:
    position_history.append(reading)
    if len(position_history) > MAX_HISTORY:
        del position_history[:len(position_history) - MAX_HISTORY]

    stats["total_readings"] += 1

    anomalies = detect_anomalies(reading, position_history[:-1])

    for a in anomalies:
        anomaly_log.append(a)
        stats["total_anomalies"] += 1
        atype = a["type"]
        if atype in stats["anomalies_by_type"]:
            stats["anomalies_by_type"][atype] += 1
    if len(anomaly_log) > MAX_ANOMALY_LOG:
        del anomaly_log[:len(anomaly_log) - MAX_ANOMALY_LOG]

    await manager.broadcast({
        "type": "position_update",
        "reading": reading,
        "anomalies": anomalies,
        "stats": {**stats, "source": data_source["mode"]},
    })


async def _poll_loop() -> None:
    while True:
        mode = data_source["mode"]
        stats["source"] = mode

        if mode == "live":
            reading = await fetch_live_position()
            if reading:
                await process_reading(reading)
        else:
            readings = fetch_synthetic_positions()
            for r in readings:
                await process_reading(r)

        await asyncio.sleep(POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    stats["uptime_start"] = int(time.time())
    task = asyncio.create_task(_poll_loop())
    yield
    task.cancel()


app = FastAPI(title="Satellite Anomaly Detection API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/api/status")
async def get_status() -> dict:
    return {
        **stats,
        "source": data_source["mode"],
        "history_length": len(position_history),
        "anomaly_log_length": len(anomaly_log),
    }


@app.get("/api/positions")
async def get_positions(limit: int = 100) -> list[dict]:
    return position_history[-limit:]


@app.get("/api/anomalies")
async def get_anomalies(limit: int = 50) -> list[dict]:
    return anomaly_log[-limit:]


@app.post("/api/source/{mode}")
async def set_source(mode: str) -> dict:
    if mode not in ("live", "synthetic"):
        return {"error": "mode must be 'live' or 'synthetic'"}
    data_source["mode"] = mode
    position_history.clear()
    anomaly_log.clear()
    last_seen_db_ts["ts"] = 0
    stats["total_readings"] = 0
    stats["total_anomalies"] = 0
    stats["anomalies_by_type"] = {"orbital_deviation": 0, "connectivity_loss": 0, "impossible_coords": 0}
    stats["source"] = mode
    await manager.broadcast({"type": "source_changed", "source": mode})
    return {"source": mode}


@app.get("/api/source")
async def get_source() -> dict:
    return {"source": data_source["mode"]}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
