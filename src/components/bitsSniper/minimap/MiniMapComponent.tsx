/**
 * Minimap – מפה סטטית לחלוטין, מצלמה וירטואלית
 *
 * ✔ המפה לא זזה ולא מסתובבת – תמונת Top-Down קבועה, בלי transform
 * ✔ "מצלמה וירטואלית": התמונה ממוקמת ב-background-position בלבד; מארקרים מחושבים יחסית לשחקן
 * ✔ השחקן תמיד במרכז; חץ השחקן בלבד מסתובב (quaternion/heading)
 * ✔ זום: scale קבוע, delta world → פיקסלים מהמרכז
 */

import { getTacticalConfig } from "../tactical/TacticalMapConfig";
import { getFlatMapDataURL } from "../tactical/drawFlatMapTopDown";

const FALLBACK_IMAGE_SIZE = 256;

/** רדיוס העולם (world units) מהשחקן עד לקצה התצוגה – קובע זום */
const RADIUS_WORLD = 40;

export type MiniMapProps = {
  mapImage: string | null;
  mapId: string;
  player: { x: number; z: number; forwardX?: number; forwardZ?: number };
  teammates?: { x: number; z: number }[];
  objectives?: { x: number; z: number; label?: string }[];
  showEnemies?: boolean;
  enemies?: { x: number; z: number }[];
  size?: number;
  zoom?: number;
  debugPosition?: boolean;
  debugEnemy?: { worldX: number; worldZ: number; mapX: number; mapY: number; forwardX: number; forwardZ: number };
};

export function MiniMapComponent({
  mapImage,
  mapId,
  player,
  teammates = [],
  objectives = [],
  showEnemies = false,
  enemies = [],
  size = 200,
  zoom = 1,
  debugPosition = false,
  debugEnemy,
}: MiniMapProps) {
  const config = getTacticalConfig(mapId);
  const bounds = config.worldBounds;

  const mapImageUrl =
    mapImage ??
    (mapId === "flat"
      ? getFlatMapDataURL(FALLBACK_IMAGE_SIZE, FALLBACK_IMAGE_SIZE, bounds)
      : "");

  const centerX = size / 2;
  const centerY = size / 2;
  const radiusPx = size / 2 - 2;
  const radiusWorld = RADIUS_WORLD / zoom;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const zoomScale = Math.max(spanX, spanZ, 1) / (2 * radiusWorld);
  const mapLayerSize = zoomScale * size;

  /* מיקום השחקן במפה (פיקסלים בשכבת המפה המלאה) – רק לחישוב background-position */
  const playerMapNormX = (player.x - bounds.minX) / spanX;
  const playerMapNormY = 1 - (player.z - bounds.minZ) / spanZ;
  const playerPx = playerMapNormX * mapLayerSize;
  const playerPy = playerMapNormY * mapLayerSize;

  /* scale: world units → פיקסלים מהמרכז בתצוגה */
  const worldToPxScale = size / (2 * radiusWorld);

  /* המרת מיקום עולם → קואורדינטות מסך (מרכז = שחקן). לא מזיזים את המפה – רק את רינדור המארקרים */
  const worldToScreen = (worldX: number, worldZ: number) => ({
    x: centerX + (worldX - player.x) * worldToPxScale,
    y: centerY - (worldZ - player.z) * worldToPxScale,
  });

  const isInRadius = (sx: number, sy: number) => {
    const distSq = (sx - centerX) ** 2 + (sy - centerY) ** 2;
    return distSq <= radiusPx * radiusPx;
  };

  const clampToCircle = (sx: number, sy: number) => {
    const dx = sx - centerX;
    const dy = sy - centerY;
    const distSq = dx * dx + dy * dy;
    if (distSq <= radiusPx * radiusPx) return { x: sx, y: sy };
    const dist = Math.sqrt(distSq);
    if (dist < 1e-6) return { x: sx, y: sy };
    const t = radiusPx / dist;
    return { x: centerX + dx * t, y: centerY + dy * t };
  };

  const arrowDeg = (Math.atan2(player.forwardX ?? 0, player.forwardZ ?? 1) * 180) / Math.PI;

  return (
    <div
      className="bits-sniper-minimap-widget"
      style={{ width: size, height: size }}
      aria-label="Minimap"
    >
      {/* מפה סטטית: בלי transform. רק background-position כדי להציג את האזור הממורכז על השחקן */}
      <div
        className="bits-sniper-minimap-widget__zoom-wrapper"
        style={{ overflow: "hidden", position: "absolute", inset: 0 }}
      >
        <div
          className="bits-sniper-minimap-widget__map"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: mapImageUrl ? `url(${mapImageUrl})` : undefined,
            backgroundSize: `${mapLayerSize}px ${mapLayerSize}px`,
            backgroundPosition: `${centerX - playerPx}px ${centerY - playerPy}px`,
            backgroundRepeat: "no-repeat",
          }}
        >
          {!mapImageUrl && <div className="bits-sniper-minimap-widget__placeholder" />}
        </div>
      </div>

      {/* מארקרים – קואורדינטות מסך (מרכז = שחקן), לא מזיזים את שכבת התמונה */}
      <div
        className="bits-sniper-minimap-widget__markers"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {teammates.map((t, i) => {
          const pos = worldToScreen(t.x, t.z);
          if (!isInRadius(pos.x, pos.y)) return null;
          const c = clampToCircle(pos.x, pos.y);
          return (
            <div
              key={i}
              className="bits-sniper-minimap-widget__teammate"
              style={{ left: c.x, top: c.y, transform: "translate(-50%, -50%)" }}
              title="Teammate"
            />
          );
        })}
        {objectives.map((o, i) => {
          const pos = worldToScreen(o.x, o.z);
          if (!isInRadius(pos.x, pos.y)) return null;
          const c = clampToCircle(pos.x, pos.y);
          return (
            <div
              key={i}
              className="bits-sniper-minimap-widget__objective"
              style={{ left: c.x, top: c.y, transform: "translate(-50%, -50%)" }}
              title={o.label}
            >
              {o.label}
            </div>
          );
        })}
        {showEnemies &&
          enemies.map((e, i) => {
            const pos = worldToScreen(e.x, e.z);
            const c = clampToCircle(pos.x, pos.y);
            const out = !isInRadius(pos.x, pos.y);
            return (
              <div
                key={i}
                className="bits-sniper-minimap-widget__enemy"
                style={{
                  left: c.x,
                  top: c.y,
                  transform: "translate(-50%, -50%)",
                  opacity: out ? 0.5 : 1,
                }}
                title="Enemy"
              >
                {debugPosition && (
                  <span className="bits-sniper-minimap-widget__enemy-index">{i + 1}</span>
                )}
              </div>
            );
          })}
        {debugPosition &&
          debugEnemy &&
          (() => {
            const pos = worldToScreen(debugEnemy.worldX, debugEnemy.worldZ);
            return (
              <div
                className="bits-sniper-minimap-widget__debug"
                style={{ left: pos.x, top: pos.y, transform: "translate(-50%, -50%)" }}
                title={`world (${debugEnemy.worldX.toFixed(1)}, ${debugEnemy.worldZ.toFixed(1)})`}
              >
                <span className="bits-sniper-minimap-widget__debug-dot" />
              </div>
            );
          })()}
      </div>

      {/* חץ השחקן – תמיד במרכז, מסתובב בלבד */}
      <div className="bits-sniper-minimap-widget__player-layer">
        <div
          className="bits-sniper-minimap-widget__player"
          style={{
            left: centerX,
            top: centerY,
            transform: `translate(-50%, -50%) rotate(${arrowDeg}deg)`,
          }}
          title="You"
        />
      </div>

      {debugPosition && (
        <>
          <div className="bits-sniper-minimap-widget__debug-circle" aria-hidden />
          <div
            className="bits-sniper-minimap-widget__debug-direction"
            style={{ left: centerX, top: centerY, height: radiusPx * 0.6 }}
            aria-hidden
          />
        </>
      )}
    </div>
  );
}
