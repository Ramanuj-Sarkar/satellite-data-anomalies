import { useMemo, useRef, useEffect, useState, useCallback } from "react";

export default function CatalogList({ catalogPositions, selectedSat, onSelectSat }) {
  const listRef = useRef(null);
  const itemRefs = useRef({});
  const [query, setQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  const sorted = useMemo(() => {
    return [...catalogPositions].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogPositions]);

  useEffect(() => {
    if (selectedSat != null && itemRefs.current[selectedSat]) {
      itemRefs.current[selectedSat].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedSat]);

  const handleSearch = useCallback(() => {
    const q = query.trim().toUpperCase();
    if (!q) return;
    const match = sorted.find(
      (s) => s.name.toUpperCase().includes(q) || String(s.norad_id) === q
    );
    if (match) {
      setNoMatch(false);
      onSelectSat(match.norad_id);
    } else {
      setNoMatch(true);
    }
  }, [query, sorted, onSelectSat]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch]
  );

  return (
    <div className="catalog-search">
      <h3>
        Satellite Catalog
        <span className="catalog-count">{sorted.length} objects</span>
      </h3>
      <div className="catalog-search-bar">
        <input
          type="text"
          className="catalog-search-input"
          placeholder="Search by name or NORAD ID..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setNoMatch(false); }}
          onKeyDown={handleKeyDown}
        />
        <button className="catalog-search-btn" onClick={handleSearch}>Search</button>
      </div>
      {noMatch && <div className="catalog-no-match">No match found</div>}
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
