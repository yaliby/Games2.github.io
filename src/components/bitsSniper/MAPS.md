# סיכום המפות ב־Bits Sniper

מסמך זה מסכם את מה שנעשה עם המפות במשחק: מפת טקטית, מינימאפ, ובחירת spawn באינטרו.

---

## 1. מפה טקטית (מקש M)

- **מטרה:** overlay מלמעלה-למטה (top-down) במהלך משחק – רואים את השחקן, אויבים, ואפשר spawn points (דיבאג).
- **פתיחה/סגירה:** מקש **M** או קליק על הרקע. המשחק ממשיך לרוץ (ללא pause).
- **מודולים:** `tactical/TacticalMapConfig.ts`, `tactical/TacticalMapOverlay.tsx`, `tactical/drawFlatMapTopDown.ts`.
- **State במשחק:** `tacticalMapOpen`, `botPositionsForTactical`; עדכון בוטים ב־throttle של ה־HUD.
- **סטיילים:** כל ה־CSS ב־`BitsSniperGame.css` (סעיף "Tactical map overlay"): overlay, backdrop, map layer, markers, UI.
- **תיעוד מפורט:** `tactical/README.md`.

---

## 2. מינימאפ (HUD)

- **מטרה:** מפת HUD קטנה בזמן משחק – מפה קבועה, חץ השחקן מסתובב לפי כיוון.
- **מיקום:** מוצג ב־HUD כאשר `isLocked && !dead && sessionStarted`.
- **נתונים:** אותה תמונת מפה כמו Tactical (אין רינדור נוסף); `playerCoords`, `playerForward`, `botPositionsForTactical`; `selectedMapId`, `tacticalMapImage`.
- **מודולים:** `minimap/MiniMapComponent.tsx`; שימוש ב־`TacticalMapConfig` (worldToMapNormalized).
- **סטיילים:** כל ה־CSS ב־`BitsSniperGame.css` (סעיף "Minimap widget"): widget, zoom-wrapper, map, markers, player arrow, enemy/teammate/objective.
- **תיעוד מפורט:** `minimap/README.md`.

---

## 3. בחירת spawn באינטרו

- **מטרה:** לפני "Start Match" – בחירת מפה (flat / dust2 / …) ובחירת נקודות spawn לשחקן ולאויבים על גבי מפת top-down.
- **מקום:** מסך האינטרו, טאב "Enemy settings": רכיב `SpawnSelectionMap` + מקרא (כחול = שחקן, אדום = אויב).
- **מודולים:** `spawnSelection/SpawnSelectionMap.tsx`, `spawnSelectionUtils.ts`, `SpawnVisuals.ts`; `SpawnSelectionMap.css` לרכיב המפה עצמו.
- **סטיילים:**
  - רכיב המפה: `spawnSelection/SpawnSelectionMap.css`.
  - בלוק האינטרו (הנחיה, מקרא, כפתורי מפה): `BitsSniperGame.css` – `intro-setting--spawn-map`, `intro-spawn-hint`, `intro-spawn-legend`, `legend-dot`, `map-choices`.
- **תיעוד מפורט:** `spawnSelection/README.md`.

---

## 4. CSS ב־BitsSniperGame.css (מה שהוסף עבור המפות)

- **מפה טקטית:** `.bits-sniper-tactical-*` (overlay, backdrop, map-layer, map-image, markers, marker--player-arrow, marker--enemy, marker--spawn, tactical-ui, tactical-close, tactical-title).
- **מינימאפ:** `.bits-sniper-minimap-widget*` (widget, zoom-wrapper, map, placeholder, markers, player, teammate, enemy, objective, debug).
- **אינטרו + spawn:** `.bits-sniper-intro-tabs`, `.bits-sniper-intro-tab`, `.bits-sniper-map-choices`, `.bits-sniper-intro-setting--spawn-map`, `.bits-sniper-intro-spawn-hint`, `.bits-sniper-intro-spawn-legend`, `.bits-sniper-legend-dot.is-player` / `.is-enemy`, `.bits-sniper-weapon-pool`, `.bits-sniper-intro-step`.

---

## 5. קונפיג מפות

- **מקור:** `tactical/TacticalMapConfig.ts` – `TACTICAL_MAP_CONFIGS` (למשל `flat`, `arena`, `dust2`).
- **לכל מפה:** `mapId`, `mapImage` (אופציונלי), `worldBounds` (minX, maxX, minZ, maxZ), `spawnPoints` (דיבאג).
- **המרת קואורדינטות:** `worldToMapNormalized(worldX, worldZ, bounds)` → `{ x, y }` ב־0–1 לשימוש ב־`left: x*100%`, `top: y*100%`.
