"""CelesTrak OMM catalog with SGP4 propagation.

Fetches the satellite catalog from CelesTrak's OMM JSON endpoint,
builds SGP4 satellite objects, and propagates positions on demand.
The catalog is cached for two hours.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
from sgp4 import omm as sgp4_omm
from sgp4.api import Satrec, jday

CELESTRAK_GROUPS = ["stations", "visual", "weather", "science"]
CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php"
CATALOG_TTL = 7200  # 2 hours

EARTH_RADIUS_KM = 6371.0


@dataclass
class SatelliteEntry:
    norad_id: int
    name: str
    satrec: Satrec
    object_type: str = ""
    intl_designator: str = ""


@dataclass
class CatalogState:
    entries: dict[int, SatelliteEntry] = field(default_factory=dict)
    last_fetched: float = 0.0
    fetch_error: str | None = None
    fetching: bool = False


catalog = CatalogState()


async def fetch_catalog() -> None:
    if catalog.fetching:
        return
    catalog.fetching = True
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; OrbitalMonitor/1.0)"}
        async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
            omm_list = []
            for group in CELESTRAK_GROUPS:
                url = f"{CELESTRAK_BASE}?GROUP={group}&FORMAT=json"
                resp = await client.get(url)
                resp.raise_for_status()
                omm_list.extend(resp.json())

        entries: dict[int, SatelliteEntry] = {}
        for omm_data in omm_list:
            norad_id = omm_data.get("NORAD_CAT_ID", 0)
            if norad_id == 0:
                continue
            try:
                sat = Satrec()
                sgp4_omm.initialize(sat, omm_data)
            except Exception:
                continue
            entries[norad_id] = SatelliteEntry(
                norad_id=norad_id,
                name=omm_data.get("OBJECT_NAME", f"SAT-{norad_id}"),
                satrec=sat,
                object_type=omm_data.get("OBJECT_TYPE", ""),
                intl_designator=omm_data.get("OBJECT_ID", ""),
            )

        catalog.entries = entries
        catalog.last_fetched = time.time()
        catalog.fetch_error = None
    except Exception as exc:
        catalog.fetch_error = str(exc)
    finally:
        catalog.fetching = False


def is_catalog_stale() -> bool:
    return (time.time() - catalog.last_fetched) > CATALOG_TTL


def _gmst(jd: float, fr: float) -> float:
    """Greenwich Mean Sidereal Time in radians."""
    t = ((jd - 2451545.0) + fr) / 36525.0
    gmst_sec = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t
    return math.fmod(math.radians(gmst_sec / 240.0), 2 * math.pi)


def propagate_satellite(sat: SatelliteEntry, ts: float | None = None) -> dict | None:
    """Propagate a single satellite to the given unix timestamp (default: now)."""
    if ts is None:
        ts = time.time()

    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)

    e, r, v = sat.satrec.sgp4(jd, fr)
    if e != 0:
        return None

    x, y, z = r
    vx, vy, vz = v

    gmst = _gmst(jd, fr)
    x_ecef = x * math.cos(gmst) + y * math.sin(gmst)
    y_ecef = -x * math.sin(gmst) + y * math.cos(gmst)
    z_ecef = z

    lon = math.degrees(math.atan2(y_ecef, x_ecef))
    hyp = math.sqrt(x_ecef ** 2 + y_ecef ** 2)
    lat = math.degrees(math.atan2(z_ecef, hyp))
    alt = math.sqrt(x ** 2 + y ** 2 + z ** 2) - EARTH_RADIUS_KM
    speed = math.sqrt(vx ** 2 + vy ** 2 + vz ** 2)

    return {
        "norad_id": sat.norad_id,
        "name": sat.name,
        "latitude": round(lat, 4),
        "longitude": round(lon, 4),
        "altitude_km": round(alt, 2),
        "velocity_km_s": round(speed, 3),
        "timestamp": int(ts),
    }


def propagate_all(ts: float | None = None, limit: int = 0) -> list[dict]:
    results = []
    for sat in catalog.entries.values():
        pos = propagate_satellite(sat, ts)
        if pos is not None:
            results.append(pos)
            if limit and len(results) >= limit:
                break
    return results


def search_catalog(query: str, limit: int = 50) -> list[dict]:
    query_upper = query.upper().strip()
    results = []

    try:
        norad_id = int(query_upper)
        if norad_id in catalog.entries:
            sat = catalog.entries[norad_id]
            results.append({"norad_id": sat.norad_id, "name": sat.name, "object_type": sat.object_type})
            return results
    except ValueError:
        pass

    for sat in catalog.entries.values():
        if query_upper in sat.name.upper():
            results.append({"norad_id": sat.norad_id, "name": sat.name, "object_type": sat.object_type})
            if len(results) >= limit:
                break
    return results


# ---------------------------------------------------------------------------
# Conjunction screening
# ---------------------------------------------------------------------------

SCREENING_DISTANCE_KM = 25.0


def screen_conjunctions(ts: float | None = None, threshold_km: float = SCREENING_DISTANCE_KM) -> list[dict]:
    """Find pairs of satellites within threshold_km of each other."""
    if ts is None:
        ts = time.time()

    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)

    positions = []
    for sat in catalog.entries.values():
        e, r, _v = sat.satrec.sgp4(jd, fr)
        if e != 0:
            continue
        positions.append((sat.norad_id, sat.name, r[0], r[1], r[2]))

    if len(positions) < 2:
        return []

    cell_size = threshold_km
    grid: dict[tuple[int, int, int], list[int]] = {}
    for idx, (_, _, x, y, z) in enumerate(positions):
        cx, cy, cz = int(x // cell_size), int(y // cell_size), int(z // cell_size)
        grid.setdefault((cx, cy, cz), []).append(idx)

    conjunctions = []
    seen: set[tuple[int, int]] = set()
    threshold_sq = threshold_km ** 2

    for (cx, cy, cz), indices in grid.items():
        neighbors: list[int] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    neighbors.extend(grid.get((cx + dx, cy + dy, cz + dz), []))

        for i in indices:
            for j in neighbors:
                if i >= j:
                    continue
                pair = (positions[i][0], positions[j][0])
                if pair in seen:
                    continue
                seen.add(pair)

                dx2 = positions[i][2] - positions[j][2]
                dy2 = positions[i][3] - positions[j][3]
                dz2 = positions[i][4] - positions[j][4]
                dist_sq = dx2 * dx2 + dy2 * dy2 + dz2 * dz2

                if dist_sq < threshold_sq:
                    dist = math.sqrt(dist_sq)
                    conjunctions.append({
                        "sat1_norad_id": positions[i][0],
                        "sat1_name": positions[i][1],
                        "sat2_norad_id": positions[j][0],
                        "sat2_name": positions[j][1],
                        "distance_km": round(dist, 2),
                        "timestamp": int(ts),
                    })

    conjunctions.sort(key=lambda c: c["distance_km"])
    return conjunctions[:100]
