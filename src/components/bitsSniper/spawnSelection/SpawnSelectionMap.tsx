import { useCallback, useEffect, useRef, useState } from "react";
import type { WorldBounds } from "../tactical/TacticalMapConfig";
import { mapToWorld, worldToMap } from "./spawnSelectionUtils";
import "./SpawnSelectionMap.css";

export type SpawnPointType = "player" | "enemy";

export interface SpawnPoint {
  id: string;
  type: SpawnPointType;
  worldPosition: { x: number; z: number };
}

export interface SpawnSelectionMapProps {
  /** Top-down map image URL (e.g. from tactical snapshot) */
  mapImageUrl: string | null;
  /** World bounds for coordinate conversion */
  bounds: WorldBounds;
  /** Current spawn points (controlled from parent if needed) */
  value?: { player: SpawnPoint | null; enemies: SpawnPoint[] };
  /** Called when spawns change */
  onChange?: (player: SpawnPoint | null, enemies: SpawnPoint[]) => void;
  /** Radius in pixels for hit-test (delete / hover) */
  pointRadius?: number;
}

const POINT_RADIUS = 22;

function generateId(): string {
  return `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function SpawnSelectionMap({
  mapImageUrl,
  bounds,
  value,
  onChange,
  pointRadius = POINT_RADIUS,
}: SpawnSelectionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [internalPlayer, setInternalPlayer] = useState<SpawnPoint | null>(() => value?.player ?? null);
  const [internalEnemies, setInternalEnemies] = useState<SpawnPoint[]>(() => value?.enemies ?? []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const player = value?.player ?? internalPlayer;
  const enemies = value?.enemies ?? internalEnemies;

  const notify = useCallback(
    (p: SpawnPoint | null, en: SpawnPoint[]) => {
      if (onChange) onChange(p, en);
    },
    [onChange]
  );

  const setPlayer = useCallback(
    (p: SpawnPoint | null) => {
      if (!value) setInternalPlayer(p);
      notify(p, enemies);
    },
    [value, enemies, notify]
  );

  const setEnemies = useCallback(
    (en: SpawnPoint[]) => {
      if (!value) setInternalEnemies(en);
      notify(player, en);
    },
    [value, player, notify]
  );

  const getMapRect = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    return el.getBoundingClientRect();
  }, []);

  const resizeObserver = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const w = Math.floor(width);
    const h = Math.floor(height);
    if (w !== size.w || h !== size.h) setSize({ w, h });
  }, [size.w, size.h]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(resizeObserver);
    ro.observe(el);
    resizeObserver();
    return () => ro.disconnect();
  }, [resizeObserver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 0 || size.h <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    if (dpr !== 1) ctx.scale(dpr, dpr);

    const allPoints: { point: SpawnPoint; px: { x: number; y: number } }[] = [];
    if (player) {
      const px = worldToMap(player.worldPosition.x, player.worldPosition.z, size.w, size.h, bounds);
      allPoints.push({ point: player, px });
    }
    enemies.forEach((pt) => {
      const px = worldToMap(pt.worldPosition.x, pt.worldPosition.z, size.w, size.h, bounds);
      allPoints.push({ point: pt, px });
    });

    ctx.clearRect(0, 0, size.w, size.h);

    const drawCircle = (
      x: number,
      y: number,
      fill: string,
      stroke: string,
      radius: number,
      label: string,
      isHover: boolean
    ) => {
      const r = isHover ? radius + 6 : radius;
      const glowR = r + 12;

      ctx.save();

      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = fill.replace(/[\d.]+\)$/, "0.35)");
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.fillStyle = fill;
      ctx.fill();

      ctx.strokeStyle = stroke;
      ctx.lineWidth = isHover ? 4 : 3;
      ctx.stroke();

      if (label) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(14, Math.round(radius * 0.65))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
        ctx.lineWidth = 3;
        ctx.strokeText(label, x, y);
        ctx.fillText(label, x, y);
      }

      ctx.restore();
    };

    let labelIndex = 1;
    allPoints.forEach(({ point, px }) => {
      const isPlayer = point.type === "player";
      const isHover = hoveredId === point.id;
      const fill = isPlayer ? "rgba(59, 130, 246, 0.9)" : "rgba(239, 68, 68, 0.9)";
      const stroke = isPlayer ? "rgba(147, 197, 253, 0.95)" : "rgba(252, 165, 165, 0.95)";
      const label = isPlayer ? "P" : String(labelIndex++);
      drawCircle(px.x, px.y, fill, stroke, pointRadius, label, isHover);
    });
  }, [player, enemies, bounds, size, hoveredId, pointRadius]);

  const findPointAt = useCallback(
    (clientX: number, clientY: number): SpawnPoint | null => {
      const rect = getMapRect();
      if (!rect) return null;
      const clickX = clientX - rect.left;
      const clickY = clientY - rect.top;
      const hitRadius = pointRadius + 8;
      const all: SpawnPoint[] = player ? [player] : [];
      all.push(...enemies);
      for (const pt of all) {
        const px = worldToMap(pt.worldPosition.x, pt.worldPosition.z, rect.width, rect.height, bounds);
        const dx = clickX - px.x;
        const dy = clickY - px.y;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) return pt;
      }
      return null;
    },
    [getMapRect, player, enemies, bounds, pointRadius]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = getMapRect();
      if (!rect) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      const clickX = clientX - rect.left;
      const clickY = clientY - rect.top;
      const mapWidth = rect.width;
      const mapHeight = rect.height;
      const atPoint = findPointAt(clientX, clientY);

      if (atPoint) {
        e.preventDefault();
        if (atPoint.type === "player") setPlayer(null);
        else setEnemies(enemies.filter((p) => p.id !== atPoint.id));
        setHoveredId(null);
        return;
      }

      const { x, z } = mapToWorld(clickX, clickY, mapWidth, mapHeight, bounds);
      if (e.button === 2) {
        e.preventDefault();
        setPlayer({ id: generateId(), type: "player", worldPosition: { x, z } });
      } else if (e.button === 0) {
        setEnemies([...enemies, { id: generateId(), type: "enemy", worldPosition: { x, z } }]);
      }
    },
    [getMapRect, bounds, findPointAt, enemies, setPlayer, setEnemies]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const at = findPointAt(e.clientX, e.clientY);
      setHoveredId(at?.id ?? null);
    },
    [findPointAt]
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  return (
    <div
      className={`spawn-selection-container${!mapImageUrl ? " no-map-image" : ""}`}
      ref={containerRef}
    >
      <div
        className="spawn-selection-map-image"
        style={
          mapImageUrl
            ? { backgroundImage: `url(${mapImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      />
      <canvas
        ref={canvasRef}
        className="spawn-selection-overlay"
        width={size.w}
        height={size.h}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onContextMenu={handleContextMenu}
        role="img"
        aria-label="Spawn selection map: left click add enemy, right click set player, click on a point to delete it"
      />
    </div>
  );
}
