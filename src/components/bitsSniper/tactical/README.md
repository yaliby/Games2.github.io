# Tactical Map (Top-Down Overlay)

## A) ארכיטקטורה

- **Per-Map**: לכל מפה יש `TacticalMapConfig`: `mapImage`, `worldBounds`, `spawnPoints`.
- **MapOverlay**: קומפוננטת React בלבד – מציגה שכבות, מקבלת נתונים (player, enemies) כ-props.
- **המרת קואורדינטות**: `worldToMapNormalized(worldX, worldZ, bounds)` → `{ x, y }` ב־0–1.
- **מקש M**: Toggle overlay; המשחק ממשיך לרוץ (ללא Pause).
- **ניקוי**: בעת החלפת מפה (session/new map) ה-overlay נסגר; אין תלות ב-Weapon/Physics.

## B) זרימת פתיחה/סגירה

```
[InGame] --(M key)--> [Tactical Open]  (overlay visible, game runs)
[Tactical Open] --(M or Close)--> [Tactical Closed]
[Tactical Open] --(Backdrop click)--> [Tactical Closed]
```

## C) מודולים

| מודול | אחריות |
|--------|--------|
| `TacticalMapConfig.ts` | טיפוסים, `worldToMap` / `worldToMapNormalized`, רישום קונפיג לכל מפה |
| `TacticalMapOverlay.tsx` | Layer 1–4: backdrop, map image, markers, UI; רק הצגה + אירוע סגירה |
| `BitsSniperGame.tsx` | state `tacticalMapOpen`, `botPositionsForTactical`, מקש M, רינדור Overlay והזנת נתונים |

## D) המרת קואורדינטות (מתמטיקה)

- **עולם**: `worldBounds = { minX, maxX, minZ, maxZ }`.
- **תמונה**: רוחב `W`, גובה `H` (פיקסלים או נורמליזציה 0–1).

נורמליזציה:

- `t = (worldX - minX) / (maxX - minX)`  → 0–1 (ציר X במפה).
- `s = (worldZ - minZ) / (maxZ - minZ)`  → 0–1 (ציר Z בעולם = ציר Y במפה).
- **מפה (Top-Down)**: בדרך כלל ציר +Z בעולם = "למעלה" בתמונה, אז:
  - `mapX = t * W`
  - `mapY = (1 - s) * H`

ב־`worldToMapNormalized`: מחזירים `{ x: t, y: 1 - s }` לשימוש ב־`left: x*100%`, `top: y*100%`.

## E) שינויים בקוד הקיים

- **מקש M**: הוסר מ־fullscreen; משמש רק לפתיחת/סגירת Tactical Map. Fullscreen נשאר ב־Alt+Enter.
- **State**: נוספו `tacticalMapOpen`, `botPositionsForTactical`; עדכון בוטים בתוך ה־throttle של ה־HUD (אותו בלוק של `setPlayerCoords`).
- **Overlay**: רינדור מותנה ב־`tacticalMapOpen && sessionStarted`; מקבל `mapId`, `player`, `enemies`, `showSpawnPoints`, `onClose`.
- **קונפיג מפות**: `TACTICAL_MAP_CONFIGS` ב־`TacticalMapConfig.ts`; מפה `flat` עם `worldBounds` ו־`spawnPoints`. הוספת תמונה למפה: להגדיר `mapImage: "path/to/topdown.png"` בקונפיג.

## F) Styling (CSS)

כל הסטיילים של ה־Tactical Map Overlay נמצאים ב־`BitsSniperGame.css`:

- `.bits-sniper-tactical-overlay` – עטיפה מרכזית (flex, padding)
- `.bits-sniper-tactical-backdrop` – רקע כהה + blur, קליק לסגירה
- `.bits-sniper-tactical-map-layer` – שכבת המפה (גבול, צל)
- `.bits-sniper-tactical-map-image` / `.bits-sniper-tactical-map-placeholder` – תמונת מפה או placeholder
- `.bits-sniper-tactical-markers` – מיכל מארקרים
- `.bits-sniper-tactical-marker--player-arrow` – חץ שחקן (משולש)
- `.bits-sniper-tactical-marker--enemy` – נקודת אויב (עיגול אדום)
- `.bits-sniper-tactical-marker--spawn` – נקודת spawn (דיבאג)
- `.bits-sniper-tactical-ui` – כותרת + כפתור סגירה (TACTICAL MAP [M], ✕)
