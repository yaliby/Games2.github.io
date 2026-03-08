import {
  getTacticalConfig,
  worldToMapNormalized,
} from "./TacticalMapConfig";
import { getFlatMapDataURL } from "./drawFlatMapTopDown";

type Props = {
  mapId: string;
  /** Optional: override map image (e.g. snapshot rendered from Three.js) */
  mapImageOverride?: string;
  /** World X/Z; arrow from forwardX/forwardZ (getWorldQuaternion then (0,0,-1).applyQuaternion) */
  player: { x: number; z: number; forwardX?: number; forwardZ?: number };
  /** Enemy positions + forward dir on XZ */
  enemies: { x: number; z: number; forwardX?: number; forwardZ?: number }[];
  /** Teammate positions (e.g. CTF friendly bots) – shown like player (same team) */
  teammates?: { x: number; z: number; forwardX?: number; forwardZ?: number }[];
  showSpawnPoints?: boolean;
  onClose: () => void;
};

const MAP_SIZE = 420;
const TACTICAL_IMAGE_SIZE = 512;

export function TacticalMapOverlay({
  mapId,
  mapImageOverride,
  player,
  enemies,
  teammates = [],
  showSpawnPoints = false,
  onClose,
}: Props) {
  const config = getTacticalConfig(mapId);
  const bounds = config.worldBounds;

  const mapImageUrl =
    mapImageOverride ??
    (config.mapImage
      ? config.mapImage
      : mapId === "flat"
        ? getFlatMapDataURL(TACTICAL_IMAGE_SIZE, TACTICAL_IMAGE_SIZE, bounds)
        : "");

  const toPct = (worldX: number, worldZ: number) => {
    const { x, y } = worldToMapNormalized(worldX, worldZ, bounds);
    return { left: `${x * 100}%`, top: `${y * 100}%` };
  };

  const playerPos = toPct(player.x, player.z);
  /** Arrow from world forward: angle in XZ, map up = +Z. angleRad = atan2(forwardX, forwardZ) */
  const fx = player.forwardX ?? 0;
  const fz = player.forwardZ ?? -1;
  const arrowDeg = (Math.atan2(fx, fz) * 180) / Math.PI;

  return (
    <div className="bits-sniper-tactical-overlay" role="dialog" aria-label="Tactical map">
      {/* Layer 1: Darkened background */}
      <div className="bits-sniper-tactical-backdrop" onClick={onClose} aria-hidden />

      {/* Wrapper: Layer 2 (map) + Layer 3 (markers) same size */}
      <div
        className="bits-sniper-tactical-map-layer"
        style={{ width: MAP_SIZE, height: MAP_SIZE }}
      >
        {/* Layer 2: Map image (static PNG or generated from code for flat) */}
        <div
          className="bits-sniper-tactical-map-image"
          style={{
            width: MAP_SIZE,
            height: MAP_SIZE,
            backgroundImage: mapImageUrl ? `url(${mapImageUrl})` : undefined,
          }}
        >
          {!mapImageUrl && (
            <div className="bits-sniper-tactical-map-placeholder" />
          )}
        </div>

        {/* Layer 3: Dynamic markers */}
        <div className="bits-sniper-tactical-markers">
        {/* Player: arrow (same as minimap) with rotation */}
        <div
          className="bits-sniper-tactical-marker bits-sniper-tactical-marker--player bits-sniper-tactical-marker--player-arrow"
          style={{
            left: playerPos.left,
            top: playerPos.top,
            transform: `translate(-50%, -50%) rotate(${arrowDeg}deg)`,
          }}
          title="You"
        />
        {/* Teammates – כמו השחקן (קבוצה שלנו) */}
        {teammates.map((t, i) => {
          const p = toPct(t.x, t.z);
          const tx = t.forwardX ?? 0;
          const tz = t.forwardZ ?? 1;
          const teammateDeg = (Math.atan2(tx, tz) * 180) / Math.PI;
          return (
            <div
              key={`tm-${i}`}
              className="bits-sniper-tactical-marker bits-sniper-tactical-marker--teammate"
              style={{
                left: p.left,
                top: p.top,
                transform: `translate(-50%, -50%) rotate(${teammateDeg}deg)`,
              }}
              title="Teammate"
            />
          );
        })}
        {/* Enemies – חצים עם כיוון אמיתי, כמו השחקן */}
        {enemies.map((e, i) => {
          const p = toPct(e.x, e.z);
          const ex = e.forwardX ?? 0;
          const ez = e.forwardZ ?? 1;
          const enemyDeg = (Math.atan2(ex, ez) * 180) / Math.PI;
          return (
            <div
              key={i}
              className="bits-sniper-tactical-marker bits-sniper-tactical-marker--enemy"
              style={{
                left: p.left,
                top: p.top,
                transform: `translate(-50%, -50%) rotate(${enemyDeg + 180}deg)`,
              }}
              title="Enemy"
            />
          );
        })}
        {/* Spawn points (debug) */}
        {showSpawnPoints &&
          config.spawnPoints.map((s, i) => {
            const p = toPct(s.x, s.z);
            return (
              <div
                key={i}
                className="bits-sniper-tactical-marker bits-sniper-tactical-marker--spawn"
                style={{ left: p.left, top: p.top }}
                title={s.label}
              >
                {s.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Layer 4: UI frame / labels */}
      <div className="bits-sniper-tactical-ui">
        <span className="bits-sniper-tactical-title">TACTICAL MAP [M]</span>
        <button
          type="button"
          className="bits-sniper-tactical-close"
          onClick={onClose}
          aria-label="Close tactical map"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
