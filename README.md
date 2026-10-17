# Satellite Data Anomalies

Real-time satellite telemetry anomaly detection platform. Ingests multispectral and sensor data streams from Earth observation satellites, applies anomaly detection algorithms, and surfaces deviations through a live monitoring dashboard.

## What This Project Does

Satellites in orbit continuously transmit telemetry and observation data — thermal readings, spectral band intensities, vegetation indices, atmospheric measurements, and onboard system health metrics. Most of this data is normal. The challenge is catching the moments it isn't.

This platform processes streaming satellite data to detect:

- **Environmental anomalies** — sudden changes in land surface temperature, unexpected vegetation loss (NDVI drops), water body changes, or atmospheric composition shifts that may indicate wildfires, deforestation, flooding, or industrial emissions
- **Sensor anomalies** — instrument drift, calibration errors, or hardware degradation that could compromise data quality before downstream consumers notice
- **Orbital/telemetry anomalies** — unexpected changes in satellite health metrics (battery voltage, solar panel output, attitude control) that may signal impending hardware failure

## Use Cases

| Domain | What we detect | Why it matters |
|---|---|---|
| **Wildfire early warning** | Thermal hotspots + rapid NDVI decline in the same region | Hours of lead time vs. ground-based detection |
| **Deforestation monitoring** | Progressive vegetation index drops across consecutive passes | Evidence for enforcement and carbon credit verification |
| **Flood detection** | Water index spikes in normally dry regions | Rapid disaster response coordination |
| **Agricultural stress** | Gradual NDVI decline patterns across crop regions | Early intervention before yield loss |
| **Satellite health** | Battery, thermal, and attitude anomalies in telemetry | Prevent data gaps by scheduling maintenance before failure |
| **Air quality** | Aerosol optical depth and NO2 column density spikes | Industrial emission events and compliance monitoring |

## Tech Stack

- **Python** — data ingestion, processing, and anomaly detection
- **FastAPI** — real-time API with WebSocket streaming
- **SQLite** — time-series storage for telemetry and detected anomalies
- **React** — live monitoring dashboard with maps and charts
- **Docker** — containerized deployment

## Project Status

Under active development.
