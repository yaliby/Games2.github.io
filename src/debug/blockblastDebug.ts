import { useEffect, useRef, useCallback } from "react";

/** =============== Types =============== */
type AnyBoard = any;
type AnyShape = any;
type AnyTrayItem = any;

export type BlockBlastDumpInput = {
  board: AnyBoard;
  tray: AnyTrayItem[];
  score?: number;
  rows?: number;
  cols?: number;
};

type DumpPayload = {
  rows: number;
  cols: number;
  score: number;
  board: number[][];
  tray: Array<{ colorId: number; cells: Array<{ r: number; c: number }> }>;
};

/** =============== Helpers =============== */
function cellToChar(v: any): string {
  if (!v) return ".";
  if (typeof v === "number") {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return alphabet[(v - 1) % alphabet.length] ?? "#";
  }
  if (typeof v === "object" && v !== null) {
    const n = Number(v.colorId ?? v.color ?? v.id ?? 1);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return alphabet[(n - 1) % alphabet.length] ?? "#";
  }
  return "#";
}

export function boardToAscii(board: AnyBoard, rows = 8, cols = 8): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const v = board?.[r]?.[c];
      line += cellToChar(v);
    }
    out.push(line);
  }
  return out.join("\n");
}

function shapeCells(shape: AnyShape): Array<{ r: number; c: number }> {
  const cells =
    shape?.cells ??
    shape?.pos ??
    shape?.positions ??
    shape?.blocks ??
    shape;

  if (!Array.isArray(cells)) return [];

  return cells
    .map((p: any) => {
      if (p == null) return null;
      if (typeof p === "object") {
        const r = p.r ?? p.row ?? p.y;
        const c = p.c ?? p.col ?? p.x;
        if (Number.isFinite(r) && Number.isFinite(c)) return { r: Number(r), c: Number(c) };
      }
      return null;
    })
    .filter(Boolean) as Array<{ r: number; c: number }>;
}

export function shapeToAscii(shape: AnyShape): string {
  const cells = shapeCells(shape);
  if (cells.length === 0) return "(empty shape)";

  const minR = Math.min(...cells.map((p) => p.r));
  const minC = Math.min(...cells.map((p) => p.c));
  const maxR = Math.max(...cells.map((p) => p.r));
  const maxC = Math.max(...cells.map((p) => p.c));

  const h = maxR - minR + 1;
  const w = maxC - minC + 1;

  const grid: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => "·"));
  for (const { r, c } of cells) grid[r - minR][c - minC] = "■";
  return grid.map((row) => row.join(" ")).join("\n");
}

export function trayToAscii(tray: AnyTrayItem[]): string {
  if (!tray || tray.length === 0) return "(tray empty)";

  return tray
    .map((t, i) => {
      const shape = t?.shape ?? t;
      const colorId = t?.colorId ?? t?.color ?? t?.id ?? "";
      const size = shapeCells(shape).length;

      return [`#${i + 1} color=${colorId} size=${size}`, shapeToAscii(shape)].join("\n");
    })
    .join("\n\n");
}

function normalizePayload(input: BlockBlastDumpInput): DumpPayload {
  const rows = input.rows ?? 8;
  const cols = input.cols ?? 8;

  const payload: DumpPayload = {
    rows,
    cols,
    score: input.score ?? 0,
    board: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const v = input.board?.[r]?.[c];
        if (!v) return 0;
        if (typeof v === "number") return v;
        if (typeof v === "object" && v !== null) return Number(v.colorId ?? v.color ?? v.id ?? 1);
        return 1;
      })
    ),
    tray: (input.tray ?? []).map((t: any) => ({
      colorId: Number(t?.colorId ?? t?.color ?? t?.id ?? 1),
      cells: shapeCells(t?.shape ?? t),
    })),
  };

  return payload;
}

export function dumpBlockBlastState(input: BlockBlastDumpInput): string {
  const p = normalizePayload(input);

  return [
    "=== BLOCKBLAST STATE v1 ===",
    `rows=${p.rows} cols=${p.cols} score=${p.score}`,
    "",
    "BOARD:",
    boardToAscii(p.board, p.rows, p.cols),
    "",
    "TRAY:",
    trayToAscii(p.tray),
    "",
    "JSON:",
    JSON.stringify(p),
    "=== END ===",
  ].join("\n");
}

export async function copyDumpToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    console.log("[BB] dump copied to clipboard ✅");
  } catch {
    console.log("[BB] clipboard failed; dump printed below:");
    console.log(text);
  }
}

/** =============== React Hook: one-liner integration =============== */
export function useBlockBlastDebugDump(input: BlockBlastDumpInput, opts?: { hotkey?: string }) {
  const hotkey = (opts?.hotkey ?? "d").toLowerCase();

  // ✅ ref מונע בעיות של "g before declaration" וסגירות לא עדכניות
  const ref = useRef<BlockBlastDumpInput>({
    board: input.board,
    tray: input.tray,
    score: input.score ?? 0,
    rows: input.rows ?? 8,
    cols: input.cols ?? 8,
  });

  // עדכון ref בכל שינוי מצב
  useEffect(() => {
    ref.current = {
      board: input.board,
      tray: input.tray,
      score: input.score ?? 0,
      rows: input.rows ?? 8,
      cols: input.cols ?? 8,
    };
  }, [input.board, input.tray, input.score, input.rows, input.cols]);

  const dumpNow = useCallback(async () => {
    const text = dumpBlockBlastState(ref.current);

    console.groupCollapsed("[BB] STATE DUMP");
    console.log(text);
    console.groupEnd();

    await copyDumpToClipboard(text);
    return text;
  }, []);

  // מאזין מקשים פעם אחת בלבד
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === hotkey) void dumpNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, dumpNow]);

  return { dumpNow };
}
