# Spawn Selection Map (Intro)

## תפקיד

במסך האינטרו (לפני "Start Match") השחקן יכול לבחור:
- **מפה** – מתוך רשימת המפות (flat, dust2, וכו') דרך כפתורי `bits-sniper-map-choices`.
- **נקודות spawn** – איפה השחקן יופיע ואיפה האויבים, על גבי מפת top-down.

הרכיב `SpawnSelectionMap` מציג תמונת מפה (אותה טקסטורה כמו Tactical Map) ומאפשר להציב/למחוק נקודות spawn (player = כחול, enemy = אדום).

## מודולים

| מודול | אחריות |
|--------|--------|
| `SpawnSelectionMap.tsx` | קנבס + קליקים, המרת קואורדינטות (worldToMap / mapToWorld), `value` / `onChange` |
| `spawnSelectionUtils.ts` | פונקציות המרה בין world ל־pixels |
| `SpawnVisuals.ts` | ויזואליזציה ב־Three.js (אופציונלי) |
| `SpawnSelectionMap.css` | סטיילים של הרכיב עצמו (קנבס, נקודות, hover) |

## אינטגרציה ב־BitsSniperGame

- במסך האינטרו, טאב "Enemy settings": מוצג `SpawnSelectionMap` עם `mapImageUrl` (מ־`tacticalMapImage` או `getFlatMapDataURL`), `bounds` מ־`getTacticalConfig(selectedMapId).worldBounds`, ו־`value` / `onChange` לניהול `customPlayerSpawn` ו־`customEnemySpawns`.
- בלחיצה על "Start Match" הערכים נשמרים ב־`customSpawnsForSessionRef` ומשמשים ל־`getChosenPlayerSpawnPosition()` ו־spawn של בוטים בתחילת הסשן.

## Styling (CSS)

- **רכיב המפה עצמו:** `SpawnSelectionMap.css` – קונטיינר, קנבס, ציור הנקודות.
- **מסך האינטרו (תווית, מקום, מקרא):** ב־`BitsSniperGame.css`:
  - `.bits-sniper-intro-setting--spawn-map` – בלוק ההגדרה של מפת spawn
  - `.bits-sniper-intro-spawn-hint` – טקסט ההנחיה
  - `.bits-sniper-intro-spawn-legend` – שורת המקרא
  - `.bits-sniper-legend-dot.is-player` – נקודה כחולה (שחקן)
  - `.bits-sniper-legend-dot.is-enemy` – נקודה אדומה (אויב)
- **בחירת מפה (כפתורים):** `.bits-sniper-map-choices` ו־`.bits-sniper-map-choices button.is-active` ב־`BitsSniperGame.css`.
