import { useMemo, useRef, useEffect } from "react";

export default function CatalogList({ catalogPositions, selectedSat, onSelectSat }) {
  const listRef = useRef(null);
  const itemRefs = useRef({});

  const sorted = useMemo(() => {
    return [...catalogPositions].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogPositions]);

  useEffect(() => {
    if (selectedSat != null && itemRefs.current[selectedSat]) {
      itemRefs.current[selectedSat].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedSat]);

  return (
    <div className="catalog-search">
      <h3>
        Satellite Catalog
        <span className="catalog-count">{sorted.length} objects</span>
      </h3>
      <div className="catalog-list" ref={listRef}>
        {sorted.map((sat) => (
          <div
            key={sat.norad_id}
            ref={(el) => { itemRefs.current[sat.norad_id] = el; }}
            className={`catalog-item ${selectedSat === sat.norad_id ? "active" : ""}`}
            onClick={() => onSelectSat(selectedSat === sat.norad_id ? null : sat.norad_id)}
          >
            <span className="catalog-item-name">{sat.name}</span>
            <span className="catalog-item-id">{sat.norad_id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
