import { lazy, Suspense, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ReferenceLine,
} from "recharts";
import CatalogSearch from "./CatalogSearch";
import ScreeningPanel from "./ScreeningPanel";

const Globe = lazy(() => import("./Globe"));

const SEVERITY_CONFIG = {
  critical: { color: "#ff3b3b", bg: "rgba(255, 59, 59, 0.12)", label: "CRITICAL" },
  warning: { color: "#ffaa00", bg: "rgba(255, 170, 0, 0.12)", label: "WARNING" },
};

const TYPE_LABELS = {
  orbital_deviation: "Orbital Deviation",
  connectivity_loss: "Connectivity Loss",
  impossible_coords: "Impossible Coordinates",
};

const TYPE_ICONS = {
  orbital_deviation: "☄",
  connectivity_loss: "⚠",
  impossible_coords: "☢",
};

function StatsBar({ stats }) {
  return (
    <div className="stats-bar">
      <div className="stat-card">
        <div className="stat-value glow-blue">{stats.total_readings}</div>
        <div className="stat-label">Total Readings</div>
      </div>
      <div className="stat-card">
        <div className="stat-value glow-red">{stats.total_anomalies}</div>
        <div className="stat-label">Total Anomalies</div>
      </div>
      <div className="stat-card">
        <div className="stat-value glow-orange">
          {stats.anomalies_by_type?.orbital_deviation || 0}
        </div>
        <div className="stat-label">Orbital Deviations</div>
      </div>
      <div className="stat-card">
        <div className="stat-value glow-yellow">
          {stats.anomalies_by_type?.connectivity_loss || 0}
        </div>
        <div className="stat-label">Connectivity Losses</div>
      </div>
      <div className="stat-card">
        <div className="stat-value glow-magenta">
          {stats.anomalies_by_type?.impossible_coords || 0}
        </div>
        <div className="stat-label">Impossible Coords</div>
      </div>
      {stats.catalog_size > 0 && (
        <div className="stat-card">
          <div className="stat-value glow-green">{stats.catalog_size}</div>
          <div className="stat-label">Catalog Objects</div>
        </div>
      )}
    </div>
  );
}

function SourceToggle({ source, onSwitch }) {
  return (
    <div className="source-toggle">
      <button
        className={`toggle-btn ${source === "celestrak" ? "active" : ""}`}
        onClick={() => onSwitch("celestrak")}
      >
        <span className="toggle-dot celestrak" />
        CelesTrak (SGP4)
      </button>
      <button
        className={`toggle-btn ${source === "synthetic" ? "active" : ""}`}
        onClick={() => onSwitch("synthetic")}
      >
        <span className="toggle-dot synthetic" />
        Synthetic
      </button>
    </div>
  );
}

function GroundTrack({ positions }) {
  const data = positions.map((p, i) => ({
    lat: p.latitude,
    lon: p.longitude,
    idx: i,
    anomaly: p.anomaly,
  }));

  const normalData = data.filter((d) => !d.anomaly);
  const anomalyData = data.filter((d) => d.anomaly);

  return (
    <div className="chart-card wide">
      <h3>ISS Ground Track</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2a4a" />
          <XAxis
            type="number"
            dataKey="lon"
            domain={[-180, 180]}
            tick={{ fontSize: 10, fill: "#5a7a9a" }}
            label={{ value: "Longitude", position: "bottom", fill: "#5a7a9a", fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="lat"
            domain={[-90, 90]}
            tick={{ fontSize: 10, fill: "#5a7a9a" }}
            label={{ value: "Lat", angle: -90, position: "insideLeft", fill: "#5a7a9a", fontSize: 11 }}
          />
          <ReferenceLine y={51.6} stroke="#1a3a5a" strokeDasharray="4 4" />
          <ReferenceLine y={-51.6} stroke="#1a3a5a" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{ background: "#0a1628", border: "1px solid #1a2a4a", borderRadius: 8, fontSize: 12 }}
            formatter={(val) => val?.toFixed(4)}
          />
          <Scatter data={normalData} fill="#00d4ff" fillOpacity={0.6} r={2} />
          <Scatter data={anomalyData} fill="#ff3b3b" fillOpacity={0.9} r={5} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function TelemetryCharts({ positions, selectedSatData }) {
  const source = selectedSatData
    ? [selectedSatData]
    : positions.slice(-60);

  const data = source.map((p, i) => ({
    tick: i,
    lat: p.latitude,
    lon: p.longitude,
    alt: p.altitude_km,
    vel: p.velocity_km_s,
    time: p.timestamp
      ? new Date(p.timestamp * 1000).toLocaleTimeString()
      : "now",
  }));

  const label = selectedSatData ? selectedSatData.name : "ISS";

  const chartProps = {
    margin: { top: 5, right: 10, bottom: 5, left: 5 },
  };

  const axisProps = {
    tick: { fontSize: 10, fill: "#5a7a9a" },
  };

  return (
    <div className="telemetry-grid">
      {selectedSatData && (
        <div className="telemetry-label" style={{ gridColumn: "1 / -1" }}>
          Showing: <strong>{label}</strong> (NORAD {selectedSatData.norad_id})
        </div>
      )}
      <div className="chart-card">
        <h3>
          Latitude <span className="current-val">{data[data.length - 1]?.lat?.toFixed(4) ?? "--"}°</span>
        </h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a4a" />
            <XAxis dataKey="time" {...axisProps} interval="preserveStartEnd" />
            <YAxis domain={[-90, 90]} width={35} {...axisProps} />
            <ReferenceLine y={51.6} stroke="#ffaa00" strokeDasharray="3 3" strokeOpacity={0.4} />
            <ReferenceLine y={-51.6} stroke="#ffaa00" strokeDasharray="3 3" strokeOpacity={0.4} />
            <Line type="monotone" dataKey="lat" stroke="#00d4ff" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>
          Longitude <span className="current-val">{data[data.length - 1]?.lon?.toFixed(4) ?? "--"}°</span>
        </h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a4a" />
            <XAxis dataKey="time" {...axisProps} interval="preserveStartEnd" />
            <YAxis domain={[-180, 180]} width={35} {...axisProps} />
            <Line type="monotone" dataKey="lon" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>
          Altitude <span className="current-val">{data[data.length - 1]?.alt?.toFixed(1) ?? "--"} km</span>
        </h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a4a" />
            <XAxis dataKey="time" {...axisProps} interval="preserveStartEnd" />
            <YAxis domain={["auto", "auto"]} width={45} {...axisProps} />
            <Line type="monotone" dataKey="alt" stroke="#00ff88" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>
          Velocity <span className="current-val">{data[data.length - 1]?.vel?.toFixed(3) ?? "--"} km/s</span>
        </h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a4a" />
            <XAxis dataKey="time" {...axisProps} interval="preserveStartEnd" />
            <YAxis domain={["auto", "auto"]} width={45} {...axisProps} />
            <Line type="monotone" dataKey="vel" stroke="#ffaa00" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AnomalyFeed({ anomalies }) {
  const reversed = [...anomalies].reverse();

  return (
    <div className="anomaly-feed">
      <h3>Anomaly Feed</h3>
      {reversed.length === 0 ? (
        <p className="no-anomalies">No anomalies detected yet. Monitoring...</p>
      ) : (
        <div className="anomaly-list">
          {reversed.slice(0, 20).map((a) => {
            const sev = SEVERITY_CONFIG[a.severity] || SEVERITY_CONFIG.warning;
            const time = new Date(a.timestamp * 1000).toLocaleTimeString();
            return (
              <div key={a.id} className={`anomaly-card ${a.severity}`}>
                <div className="anomaly-header">
                  <span className="anomaly-icon">{TYPE_ICONS[a.type]}</span>
                  <span className="anomaly-type">{TYPE_LABELS[a.type]}</span>
                  <span className="anomaly-severity" style={{ color: sev.color, background: sev.bg }}>
                    {sev.label}
                  </span>
                  <span className="anomaly-time">{time}</span>
                </div>
                <div className="anomaly-details">{a.details}</div>
                <div className="anomaly-coords">
                  {a.latitude?.toFixed(4)}°, {a.longitude?.toFixed(4)}°
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({
  positions,
  anomalies,
  stats,
  source,
  connected,
  switchSource,
  searchCatalog,
  catalogPositions,
  screeningResults,
  propagateSatellite,
}) {
  const [selectedSat, setSelectedSat] = useState(null);

  const selectedSatData = useMemo(() => {
    if (selectedSat == null) return null;
    return catalogPositions.find((s) => s.norad_id === selectedSat) || null;
  }, [selectedSat, catalogPositions]);

  const latest = positions[positions.length - 1];

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="connection-status">
            <span className={`conn-dot ${connected ? "online" : "offline"}`} />
            <span className="conn-label">{connected ? "Connected" : "Reconnecting..."}</span>
          </div>
          <div className="logo">
            <span className="logo-icon">{"\u{1F6F0}"}</span>
            <h1>Orbital Monitor</h1>
          </div>
          <span className="subtitle">ISS Anomaly Detection System</span>
        </div>
        <div className="header-right">
          <SourceToggle source={source} onSwitch={switchSource} />
        </div>
      </header>

      {latest && (
        <div className="current-position">
          <span>
            ISS Position: <strong>{latest.latitude?.toFixed(4)}°</strong>,{" "}
            <strong>{latest.longitude?.toFixed(4)}°</strong> | Alt:{" "}
            <strong>{latest.altitude_km?.toFixed(1)} km</strong> | Speed:{" "}
            <strong>{latest.velocity_km_s?.toFixed(3)} km/s</strong> |
            Source: <strong className={`source-${source}`}>{source}</strong>
          </span>
        </div>
      )}

      <StatsBar stats={stats} />

      <Suspense fallback={<div className="chart-card wide" style={{ height: 460, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a7a9a" }}>Loading 3D globe...</div>}>
        <Globe catalogPositions={catalogPositions} issPositions={positions} selectedSat={selectedSat} onSelectSat={setSelectedSat} />
      </Suspense>

      <div className="side-panels">
        <CatalogSearch catalogPositions={catalogPositions} selectedSat={selectedSat} onSelectSat={setSelectedSat} />
        <ScreeningPanel screeningResults={screeningResults} />
      </div>

      <GroundTrack positions={positions} />
      <TelemetryCharts positions={positions} selectedSatData={selectedSatData} />
      <AnomalyFeed anomalies={anomalies} />
    </div>
  );
}
