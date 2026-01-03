# ===============================
# CONFIG
# ===============================

# מקור הקוד הישן
$SOURCE = "E:\Downloads\WebTry\games\connect4"

# יעד ההטמעה בפרויקט React
$TARGET_BASE = "E:\Downloads\yaliby\src\components\connect-four"

$TARGET_ENGINE = "$TARGET_BASE\engine\rules_ai.ts"
$TARGET_RENDER = "$TARGET_BASE\render\renderer.ts"
$TARGET_REACT  = "$TARGET_BASE\ConnectFourGame.tsx"

# ===============================
# READ SOURCE FILES
# ===============================

$appJs   = Get-Content "$SOURCE\app.js" -Raw
$rulesJs = Get-Content "$SOURCE\rules_ai.js" -Raw

# ===============================
# WRITE rules_ai.ts
# ===============================

@"
//
// AUTO-INTEGRATED FROM rules_ai.js
// TODO: add strong TypeScript typing
//

$rulesJs
"@ | Set-Content -Path $TARGET_ENGINE -Encoding UTF8

# ===============================
# WRITE renderer.ts
# ===============================

@"
//
// AUTO-INTEGRATED FROM app.js (rendering logic)
// TODO: extract draw functions cleanly
//

$appJs
"@ | Set-Content -Path $TARGET_RENDER -Encoding UTF8

# ===============================
# WRITE ConnectFourGame.tsx
# ===============================

@"
import { useEffect, useRef } from 'react';

/*
  AUTO-INTEGRATED React wrapper
  TODO:
  - move logic to engine/
  - move rendering to renderer/
*/

export default function ConnectFourGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ===== ORIGINAL app.js CODE =====
$appJs
    // ===== END ORIGINAL CODE =====

  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={630}
      height={726}
      style={{
        borderRadius: '20px',
        boxShadow: '0 18px 55px rgba(0,0,0,.55)',
      }}
    />
  );
}
"@ | Set-Content -Path $TARGET_REACT -Encoding UTF8

Write-Host "[OK] Connect Four code integrated successfully"
