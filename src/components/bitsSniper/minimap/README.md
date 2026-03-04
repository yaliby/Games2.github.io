# MiniMap – העתק מדויק של המפה, מצלמה זזה עם השחקן

- **המיני־מפה = העתק מדויק של המפה** – אותה תמונת Top-Down, אותה מערכת קואורדינטות.
- **המצלמה בזום על השחקן וזזה איתו** – חלון קבוע (size×size) על שכבת מפה גדולה שמוזזת ב-`translate` לפי מיקום השחקן.
- **בלי סיבוב** – המפה והמארקרים סטטיים; רק החץ מסתובב.

## איך זה עובד

1. **שכבת מפה (pan-layer)**  
   גודל `zoomScale * size` (המפה המלאה בקנה מידה כך ש־2×radiusWorld world units = size פיקסלים).  
   `transform: translate(centerX - playerMapX * mapLayerSize, centerY - playerMapY * mapLayerSize)` – כך הנקודה של השחקן על המפה נמצאת במרכז החלון.

2. **תמונה**  
   `background-size: 100% 100%` על השכבה – העתק מדויק של המפה, ללא crop/rotate.

3. **מארקרים**  
   אותה מערכת כמו המפה: `worldToMapNormalized(worldX, worldZ)` → קואורדינטות 0–1 → מוכפל ב־`mapLayerSize` לפיקסלים. מארקרים מחוץ למעגל – clamp לקצה או opacity מופחת.

4. **חץ השחקן**  
   תמיד במרכז החלון, מסתובב לפי כיוון השחקן.

## מיקום

- המיני־מפה מוצגת בפינה הימנית העליונה (`.bits-sniper-corner-minimap`, `.bits-sniper-minimap-wrap`).
