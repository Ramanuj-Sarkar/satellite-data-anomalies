import { useEffect, useRef, useCallback, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8100";
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (API_BASE
    ? API_BASE.replace(/^http/, "ws") + "/ws"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);

const RECONNECT_DELAY = 2000;

export function useSatelliteStream() {
  const [positions, setPositions] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [stats, setStats] = useState({
    total_readings: 0,
    total_anomalies: 0,
    anomalies_by_type: {},
    source: "celestrak",
    catalog_size: 0,
  });
  const [source, setSource] = useState("celestrak");
  const [connected, setConnected] = useState(false);
  const [catalogPositions, setCatalogPositions] = useState([]);
  const [screeningResults, setScreeningResults] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const catalogTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "position_update") {
        setPositions((prev) => [...prev, msg.reading].slice(-200));
        if (msg.anomalies?.length > 0) {
          setAnomalies((prev) => [...prev, ...msg.anomalies].slice(-100));
        }
        if (msg.stats) {
          setStats(msg.stats);
          setSource(msg.stats.source);
        }
      }

      if (msg.type === "source_changed") {
        setSource(msg.source);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = () => ws.close();
  }, []);

  const switchSource = useCallback(async (mode) => {
    await fetch(`${API_BASE}/api/source/${mode}`, { method: "POST" });
    setPositions([]);
    setAnomalies([]);
    setStats((prev) => ({
      ...prev,
      total_readings: 0,
      total_anomalies: 0,
      anomalies_by_type: {},
    }));
  }, []);

  const searchCatalog = useCallback(async (query) => {
    if (!query || query.length < 1) return [];
    const resp = await fetch(`${API_BASE}/api/catalog/search?q=${encodeURIComponent(query)}&limit=20`);
    return resp.json();
  }, []);

  const fetchCatalogPositions = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/catalog/positions?limit=300`);
      const data = await resp.json();
      setCatalogPositions(data);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchScreening = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/screening?threshold_km=50`);
      const data = await resp.json();
      setScreeningResults(data);
    } catch {
      /* ignore */
    }
  }, []);

  const propagateSatellite = useCallback(async (noradId) => {
    const resp = await fetch(`${API_BASE}/api/catalog/propagate?norad_id=${noradId}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then((r) => r.json())
      .then((s) => {
        setStats(s);
        setSource(s.source);
      })
      .catch(() => {});

    connect();
    fetchCatalogPositions();
    fetchScreening();

    catalogTimer.current = setInterval(() => {
      fetchCatalogPositions();
      fetchScreening();
    }, 30000);

    return () => {
      clearTimeout(reconnectTimer.current);
      clearInterval(catalogTimer.current);
      wsRef.current?.close();
    };
  }, [connect, fetchCatalogPositions, fetchScreening]);

  return {
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
    fetchCatalogPositions,
  };
}
