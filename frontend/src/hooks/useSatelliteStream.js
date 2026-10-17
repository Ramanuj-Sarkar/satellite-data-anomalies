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
    source: "live",
  });
  const [source, setSource] = useState("live");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

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

  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then((r) => r.json())
      .then((s) => {
        setStats(s);
        setSource(s.source);
      })
      .catch(() => {});

    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { positions, anomalies, stats, source, connected, switchSource };
}
