# מצב הקוד לפי כל הצ'אטים – Bits Sniper

מסמך זה מסכם את מה שבוצע לאורך הצ'אטים ומאשר שהקוד הנוכחי תואם למצב הרצוי.

---

## 1. מפות ופלייגראונד

- **USE_FLAT_PLAYGROUND = true** (`BitsSniperMaps.tsx`) – מפת ברירת מחדל היא פלייגראונד שטוח (רצפה + 4 קירות), בלי טעינת OBJ/GLB.
- **MAPS** – בתפריט: Flat / Arena / Dust II / Level GLB; כש־USE_FLAT_PLAYGROUND דולק מוצגת רק "Flat Playground (stable)".
- **בחירת מפה** – באינטרו וב־Settings (פאנל הגדרות).
- **Tactical Map (מקש M)** – Overlay עם תמונת Top-Down (snapshot מ־OrthographicCamera או `getFlatMapDataURL`), סימון שחקן (חץ) ואויבים; `worldBounds` למפה flat = ±46 (FLAT_SPAWN_HALF).
- **MiniMap** – פינה ימין־עליונה, אותה תמונה, חץ שחקן במרכז והמפה זזה; אויבים כעיגולים אדומים. מיקום בוטים מ־`mesh.getWorldPosition()`.

---

## 2. ספאון – שחקן לא נוצר מחוץ למפה

- **FLAT_SPAWN_HALF = 46** – אזור משחק במפה השטוחה; כל הקלאמפינג והמפות משתמשים בו.
- **ספאון ראשון:** בתחילת כל פריים, לפני פיזיקה, אם `USE_FLAT_PLAYGROUND && !didFlatSpawnSnap`:  
  `yawObj.position` ← `getChosenPlayerSpawnPosition()`, אז `snapPlayerToSafeSpawn()`, איפוס מהירויות, `onGround = true`.
- **Clamp כל פריים:** במפת שטוחה, אחרי קוליז'ן: X/Z נחתכים ל־`±(FLAT_SPAWN_HALF - PLAYER_RADIUS)`.
- **נקודות ספאון:** `getChosenPlayerSpawnPosition()` מחזיר את הנקודה שנבחרה באינטרו (SpawnSelectionMap) או fallback ל־`pickFlatPlayerSpawn()`; בוטים מ־`levelBotSpawns` או fallback בתוך ±FLAT_SPAWN_HALF.
- **snapPlayerToSafeSpawn:** במפה שטוחה – בלי ריי־קאסט, רק clamp ל־X/Z וגובה `PLAYER_HEIGHT`.

---

## 3. ארכיטקטורה (Game State, Settings, Spawn)

- **GameStateManager** – `src/components/bitsSniper/game/core/GameStateManager.ts`; FSM: Boot → Loading → MainMenu → ModeSelect → MapSelect → MatchLoading → InGame ⇄ Paused → MatchEnd.
- **GameEventBus** – אירועים (StartGameClicked, PausePressed, SettingsApplied וכו'); BitsSniperGame מייבא מ־`./game/core/GameEventBus.ts`.
- **GameSettings** – `./game/settings/GameSettings.ts`; טעינה/שמירה ל־localStorage; רגישות עכבר, ADS, ווליום, מפה נבחרת.
- **SpawnManager** – `./game/spawn/SpawnManager.ts`; API ל־spawn points ו־getInitialPlayerSpawn / getBotSpawn (האינטגרציה המלאה עם הלופ נשארת ב־BitsSniperGame).

---

## 4. תפריט והגדרות

- **מסך אינטרו** – טאבים (Basic / Enemy), בחירת מפה, רגישות עכבר, ADS, ווליום, **SpawnSelectionMap** (נקודת שחקן + אויבים), ברירת נשקים; כפתור "Start Match".
- **ESC** – כשהעכבר נעול: מעבר ל־Pause (מסך השההה בתוך המשחק, בלי שחרור pointer lock). כשהעכבר לא נעול: פתיחת/סגירת Settings.
- **פאנל הגדרות** – רגישות עכבר, רגישות ADS (בזום), Master Volume, בחירת מפה; כפתורים: מסך מלא, סשן חדש, חזרה למשחק.
- **Pause-in-engine** – כשנעול ו־Paused: פאנל מקלדת (Esc/P, חצים, Enter, ←→ לסליידרים) עם `pointer-events: none` על הרקע; לחיצה על "חזרה למשחק" קוראת ל־requestLock.

---

## 5. עכבר וכוונת

- **חיתוך דלתא (מניעת קפיצות):** `movementX/movementY` נחתכים ל־±50 לפני חישוב סיבוב המצלמה.
- **כוונת** – ארבעה קווים עם רווח במרכז; גודל ורווח שונים לכל נשק (rifle, scrambler, whipper, cracker); ב־ADS הכוונת מתכווצת.
- **כיוון חץ במפות** – `atan2(sin(yaw), -cos(yaw))` כדי להתאים ל־Three.js (מבט ל־-Z) ולמפה (+Z למעלה).

---

## 6. בוטים ומשחק

- **BOT_COUNT = 1** – לצורך בדיקת פיצ'רים (ניתן להחזיר ל־7 או לערך אחר).
- **מיקום בוטים למפות** – `b.mesh.getWorldPosition(_botWorldPos)` מועבר ל־Tactical Map ו־MiniMap (לא `mesh.position` בלבד).
- **מודל בוט** – פרוצדורלי (גוף, ראש, עיניים, נשק) או לפי מה שמוגדר ב־makeBotMesh; כיוון המודל אל השחקן.

---

## 7. CSS (BitsSniperGame.css)

- נוספו/תוקנו: intro tabs, map choices, spawn legend, weapon pool, size controls, pause-backdrop, pause-actions, pause-in-engine, kill-feed, hit-ind, shield-wrap, death-overlay (inset + רקע), tactical overlay (כל השכבות), minimap widget (כל המחלקות).
- תוקן בלוק שבור של `.bits-sniper-restart-mini` וכפילות הוסרה.

---

## 8. קבצי תיעוד

- **tactical/README.md** – ארכיטקטורת Tactical Map + סעיף Styling (CSS).
- **minimap/README.md** – זרימת נתונים + Styling.
- **spawnSelection/README.md** – SpawnSelectionMap, אינטגרציה, CSS.
- **MAPS.md** – סיכום מרכזי של כל המפות (טקטית, מינימאפ, spawn).

---

## אימות מהיר

| נושא | סטטוס |
|------|--------|
| Flat playground כברירת מחדל | ✓ USE_FLAT_PLAYGROUND = true |
| ספאון ראשון על המפה | ✓ didFlatSpawnSnap + getChosenPlayerSpawnPosition + snap |
| Clamp X/Z במפה שטוחה | ✓ כל פריים |
| Tactical + MiniMap עם getWorldPosition | ✓ |
| מקש M + overlay | ✓ |
| ESC → Pause/Settings בלי לשחרר lock | ✓ |
| הגדרות: רגישות, ADS, ווליום, מפה | ✓ באינטרו וב־Settings |
| SpawnSelection באינטרו | ✓ |
| GameStateManager + GameEventBus + GameSettings | ✓ ייבוא מ־./game/ |
| חיתוך movementX/Y | ✓ maxDelta 50 |
| כוונת 4 קווים + ADS | ✓ + per-weapon |

אם משהו מהרשימה לא מתנהג כך אצלך, אפשר לבדוק לפי הסעיף הרלוונטי למעלה ולוודא שהקוד בקובץ תואם (למשל חיפוש FLAT_SPAWN_HALF, didFlatSpawnSnap, requestLock, showSettings).
