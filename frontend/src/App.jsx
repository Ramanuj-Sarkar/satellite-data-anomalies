import { useSatelliteStream } from "./hooks/useSatelliteStream";
import Dashboard from "./components/Dashboard";

export default function App() {
  const {
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
  } = useSatelliteStream();

  return (
    <Dashboard
      positions={positions}
      anomalies={anomalies}
      stats={stats}
      source={source}
      connected={connected}
      switchSource={switchSource}
      searchCatalog={searchCatalog}
      catalogPositions={catalogPositions}
      screeningResults={screeningResults}
      propagateSatellite={propagateSatellite}
    />
  );
}
