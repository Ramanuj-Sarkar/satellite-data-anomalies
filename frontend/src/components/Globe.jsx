import { useRef, useMemo, useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

const EARTH_RADIUS = 1;
const SCALE = EARTH_RADIUS / 6371;

function latLonToVec3(lat, lon, alt = 0) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const r = EARTH_RADIUS + alt * SCALE;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function Earth() {
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshStandardMaterial
        color="#0a2444"
        emissive="#041228"
        emissiveIntensity={0.3}
      />
    </mesh>
  );
}

function SatellitePoints({ catalogPositions, selectedSat, onSelectSat }) {
  const pointsRef = useRef();

  const { positions, colors, vecMap } = useMemo(() => {
    const pos = new Float32Array(catalogPositions.length * 3);
    const col = new Float32Array(catalogPositions.length * 3);
    const map = new Map();

    const normalColor = new THREE.Color("#00d4ff");
    const selectedColor = new THREE.Color("#ff3bff");

    catalogPositions.forEach((sat, i) => {
      const vec = latLonToVec3(sat.latitude, sat.longitude, sat.altitude_km);
      pos[i * 3] = vec.x;
      pos[i * 3 + 1] = vec.y;
      pos[i * 3 + 2] = vec.z;

      const c = sat.norad_id === selectedSat ? selectedColor : normalColor;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;

      map.set(i, { sat, vec });
    });

    return { positions: pos, colors: col, vecMap: map };
  }, [catalogPositions, selectedSat]);

  const handleHitClick = useCallback(
    (noradId) => {
      onSelectSat(noradId === selectedSat ? null : noradId);
    },
    [selectedSat, onSelectSat]
  );

  const selectedData = useMemo(() => {
    if (selectedSat == null) return null;
    return catalogPositions.find((s) => s.norad_id === selectedSat);
  }, [catalogPositions, selectedSat]);

  const selectedVec = useMemo(() => {
    if (!selectedData) return null;
    return latLonToVec3(selectedData.latitude, selectedData.longitude, selectedData.altitude_km);
  }, [selectedData]);

  return (
    <>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={positions}
            count={catalogPositions.length}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            array={colors}
            count={catalogPositions.length}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.03}
          vertexColors
          sizeAttenuation
          transparent
          opacity={0.9}
        />
      </points>

      {catalogPositions.map((sat, i) => {
        const entry = vecMap.get(i);
        if (!entry) return null;
        return (
          <mesh
            key={sat.norad_id}
            position={entry.vec}
            onClick={(e) => { e.stopPropagation(); handleHitClick(sat.norad_id); }}
          >
            <sphereGeometry args={[0.04, 6, 6]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}

      {selectedData && selectedVec && (
        <group position={selectedVec}>
          <mesh>
            <sphereGeometry args={[0.025, 12, 12]} />
            <meshBasicMaterial color="#ff3bff" />
          </mesh>
          <Html distanceFactor={4} style={{ pointerEvents: "none" }}>
            <div className="globe-tooltip">
              <div className="tooltip-name">{selectedData.name}</div>
              <div className="tooltip-id">NORAD {selectedData.norad_id}</div>
              <div className="tooltip-data">
                Alt: {selectedData.altitude_km?.toFixed(1)} km | Speed:{" "}
                {selectedData.velocity_km_s?.toFixed(3)} km/s
              </div>
              <div className="tooltip-coords">
                {selectedData.latitude?.toFixed(4)}°,{" "}
                {selectedData.longitude?.toFixed(4)}°
              </div>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}

function OrbitTrail({ positions }) {
  const geometry = useMemo(() => {
    if (positions.length < 2) return null;
    const points = positions.map((p) =>
      latLonToVec3(p.latitude, p.longitude, p.altitude_km)
    );
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [positions]);

  if (!geometry) return null;

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="#00d4ff" transparent opacity={0.4} />
    </line>
  );
}

function Scene({ catalogPositions, issPositions, selectedSat, onSelectSat }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 3, 5]} intensity={0.8} />
      <Earth />
      <OrbitTrail positions={issPositions} />
      <SatellitePoints
        catalogPositions={catalogPositions}
        selectedSat={selectedSat}
        onSelectSat={onSelectSat}
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={1.5}
        maxDistance={5}
        enableDamping
        dampingFactor={0.05}
      />
    </>
  );
}

function GlobeFallback() {
  return (
    <div className="chart-card wide" style={{ height: 460, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a7a9a" }}>
      3D globe failed to render. Try refreshing the page.
    </div>
  );
}

export default function Globe({ catalogPositions, issPositions, selectedSat, onSelectSat }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) return <GlobeFallback />;

  return (
    <div className="globe-container">
      <h3>
        3D Orbital View
        <span className="globe-count">{catalogPositions.length} satellites</span>
      </h3>
      <div className="globe-canvas">
        <Canvas
          camera={{ position: [0, 0, 3], fov: 45 }}
          style={{ background: "transparent" }}
          onPointerMissed={() => onSelectSat(null)}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color("#020810"), 0);
            const ctx = gl.getContext();
            ctx.canvas.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
              setHasError(true);
            });
          }}
          frameloop="demand"
        >
          <Scene
            catalogPositions={catalogPositions}
            issPositions={issPositions}
            selectedSat={selectedSat}
            onSelectSat={onSelectSat}
          />
        </Canvas>
      </div>
      <p className="globe-hint">Drag to rotate | Scroll to zoom | Click a satellite to inspect</p>
    </div>
  );
}
