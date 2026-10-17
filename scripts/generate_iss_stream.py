#!/usr/bin/env python3
"""Synthetic ISS telemetry generator.

Produces a continuous stream of ISS position data in the same JSON format
as the Open Notify API, with configurable anomaly injection.

Anomaly types:
  - orbital_deviation: position drifts from predicted orbital path
  - connectivity_loss: gaps in data (stale/repeated timestamps)
  - impossible_coords: coordinates outside valid ranges or sudden teleports

Output is written to a SQLite database (same as the API reads from) so both
the generator and the API share the same data store.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = str(Path(__file__).resolve().parent.parent / "data" / "satellite.db")

ISS_ORBITAL_PERIOD = 92.68 * 60  # ~92.68 minutes in seconds
ISS_INCLINATION = 51.6           # degrees
ISS_SPEED_KM_S = 7.66
EARTH_RADIUS_KM = 6371.0
ISS_ALTITUDE_KM = 408.0

ANOMALY_PROFILES = {
    "orbital_deviation": {
        "description": "Position drifts from predicted orbital path",
        "duration_ticks": (5, 20),
    },
    "connectivity_loss": {
        "description": "Data gap — stale/repeated positions",
        "duration_ticks": (3, 10),
    },
    "impossible_coords": {
        "description": "Coordinates outside valid ranges or sudden teleport",
        "duration_ticks": (1, 4),
    },
}


def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS iss_positions (
            id              TEXT PRIMARY KEY,
            timestamp       INTEGER NOT NULL,
            latitude        REAL NOT NULL,
            longitude       REAL NOT NULL,
            altitude_km     REAL NOT NULL,
            velocity_km_s   REAL NOT NULL,
            source          TEXT NOT NULL DEFAULT 'synthetic',
            anomaly         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_iss_ts
            ON iss_positions(timestamp DESC);
    """)
    conn.commit()
    return conn


class ISSSimulator:
    def __init__(self) -> None:
        self._t0 = time.time()
        self._tick = 0
        self._active_anomaly: str | None = None
        self._anomaly_ticks_left = 0
        self._last_lat = 0.0
        self._last_lon = 0.0
        self._stale_position: dict | None = None

    def _predicted_position(self, t: float) -> tuple[float, float, float, float]:
        elapsed = t - self._t0
        orbital_fraction = (elapsed % ISS_ORBITAL_PERIOD) / ISS_ORBITAL_PERIOD
        angle = orbital_fraction * 2 * math.pi

        lat = ISS_INCLINATION * math.sin(angle)
        lon = ((elapsed / ISS_ORBITAL_PERIOD) * -360 + orbital_fraction * 360) % 360
        if lon > 180:
            lon -= 360

        altitude = ISS_ALTITUDE_KM + random.gauss(0, 0.5)
        velocity = ISS_SPEED_KM_S + random.gauss(0, 0.02)

        return lat, lon, altitude, velocity

    def generate_reading(self, anomaly_rate: float) -> dict:
        self._tick += 1
        now = time.time()
        ts = int(now)

        if self._anomaly_ticks_left > 0:
            self._anomaly_ticks_left -= 1
            if self._anomaly_ticks_left == 0:
                self._active_anomaly = None
                self._stale_position = None
        elif random.random() < anomaly_rate:
            self._active_anomaly = random.choice(list(ANOMALY_PROFILES.keys()))
            lo, hi = ANOMALY_PROFILES[self._active_anomaly]["duration_ticks"]
            self._anomaly_ticks_left = random.randint(lo, hi)

        lat, lon, altitude, velocity = self._predicted_position(now)

        lat += random.gauss(0, 0.1)
        lon += random.gauss(0, 0.1)

        active = self._active_anomaly

        if active == "orbital_deviation":
            progress = 1 - (self._anomaly_ticks_left / 20)
            drift = min(8.0, progress * 12.0)
            lat += random.uniform(-drift, drift)
            lon += random.uniform(-drift, drift)
            altitude += random.uniform(-20, 50)
            velocity += random.uniform(-0.5, 0.5)

        elif active == "connectivity_loss":
            if self._stale_position is None:
                self._stale_position = {
                    "latitude": lat,
                    "longitude": lon,
                    "altitude_km": altitude,
                    "velocity_km_s": velocity,
                    "timestamp": ts,
                }
            return {
                "id": str(uuid.uuid4()),
                "timestamp": self._stale_position["timestamp"],
                "latitude": self._stale_position["latitude"],
                "longitude": self._stale_position["longitude"],
                "altitude_km": self._stale_position["altitude_km"],
                "velocity_km_s": self._stale_position["velocity_km_s"],
                "source": "synthetic",
                "anomaly": active,
            }

        elif active == "impossible_coords":
            attack = random.choice(["out_of_range", "teleport", "altitude_spike"])
            if attack == "out_of_range":
                lat = random.uniform(95, 180) * random.choice([-1, 1])
                lon = random.uniform(185, 360) * random.choice([-1, 1])
            elif attack == "teleport":
                lat = random.uniform(-90, 90)
                lon = random.uniform(-180, 180)
            elif attack == "altitude_spike":
                altitude = random.uniform(-100, 2000)
                velocity = random.uniform(0, 30)

        lat = round(lat, 4)
        lon = round(lon, 4)
        altitude = round(altitude, 2)
        velocity = round(velocity, 4)

        self._last_lat = lat
        self._last_lon = lon

        return {
            "id": str(uuid.uuid4()),
            "timestamp": ts,
            "latitude": lat,
            "longitude": lon,
            "altitude_km": altitude,
            "velocity_km_s": velocity,
            "source": "synthetic",
            "anomaly": active,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic ISS telemetry data.")
    parser.add_argument("--interval", type=float, default=3.0, help="Seconds between readings (default: 3.0)")
    parser.add_argument("--anomaly-rate", type=float, default=0.12, help="Anomaly probability per tick (default: 0.12)")
    parser.add_argument("--max-readings", type=int, default=None, help="Stop after N readings")
    parser.add_argument("--db", type=str, default=DB_PATH, help="SQLite database path")
    parser.add_argument("--stdout", action="store_true", help="Also print JSON to stdout")
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    conn = init_db(args.db)
    sim = ISSSimulator()
    total = 0

    print(f"Generating synthetic ISS telemetry → {args.db}", file=sys.stderr)

    try:
        while True:
            reading = sim.generate_reading(args.anomaly_rate)

            conn.execute(
                "INSERT INTO iss_positions (id, timestamp, latitude, longitude, altitude_km, velocity_km_s, source, anomaly) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (reading["id"], reading["timestamp"], reading["latitude"],
                 reading["longitude"], reading["altitude_km"], reading["velocity_km_s"],
                 reading["source"], reading["anomaly"]),
            )
            conn.commit()

            if args.stdout:
                print(json.dumps(reading))
                sys.stdout.flush()

            total += 1
            if args.max_readings and total >= args.max_readings:
                break

            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        conn.close()
        print(f"\nWrote {total} readings.", file=sys.stderr)


if __name__ == "__main__":
    main()
