export default function ScreeningPanel({ screeningResults }) {
  const filtered = screeningResults.filter((c) => c.distance_km > 0);

  return (
    <div className="screening-panel">
      <h3>
        Conjunction Screening
        <span className="screening-count">{filtered.length} close approaches</span>
      </h3>
      {filtered.length === 0 ? (
        <p className="no-screening">No close approaches detected at current threshold.</p>
      ) : (
        <div className="screening-list">
          {filtered.slice(0, 20).map((c, i) => {
            const severity =
              c.distance_km < 5 ? "critical" : c.distance_km < 15 ? "warning" : "info";
            return (
              <div key={i} className={`screening-card ${severity}`}>
                <div className="screening-pair">
                  <span className="screening-sat">{c.sat1_name}</span>
                  <span className="screening-arrow">↔</span>
                  <span className="screening-sat">{c.sat2_name}</span>
                </div>
                <div className="screening-distance">
                  <span className={`distance-value dist-${severity}`}>
                    {c.distance_km.toFixed(1)} km
                  </span>
                </div>
                <div className="screening-ids">
                  NORAD {c.sat1_norad_id} / {c.sat2_norad_id}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
