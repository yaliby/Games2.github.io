import type { CSSProperties } from "react";

const HABS_SHEET_WIDTH = 1024;
const HABS_SHEET_HEIGHT = 1536;

const HABS_GLYPHS = {
  A: { x: 53, y: 24, w: 155, h: 120 },
  B: { x: 262, y: 24, w: 130, h: 120 },
  C: { x: 445, y: 30, w: 129, h: 116 },
  E: { x: 833, y: 29, w: 130, h: 113 },
  G: { x: 232, y: 211, w: 139, h: 115 },
  H: { x: 423, y: 214, w: 126, h: 110 },
  I: { x: 600, y: 214, w: 49, h: 110 },
  L: { x: 72, y: 390, w: 109, h: 110 },
  M: { x: 233, y: 390, w: 152, h: 111 },
  O: { x: 629, y: 389, w: 154, h: 114 },
  U: { x: 824, y: 567, w: 142, h: 115 },
  Y: { x: 647, y: 747, w: 149, h: 113 },
} as const;

type GlyphChar = keyof typeof HABS_GLYPHS;

type ImageFontTextProps = {
  text: string;
  className?: string;
  scale?: number;
  gapRem?: number;
  spaceRem?: number;
  ariaLabel?: string;
};

function isGlyphChar(char: string): char is GlyphChar {
  return char in HABS_GLYPHS;
}

export default function ImageFontText({
  text,
  className,
  scale,
  gapRem,
  spaceRem,
  ariaLabel,
}: ImageFontTextProps) {
  const rootStyle: CSSProperties & Record<string, string> = {
    "--image-font-sheet-w": `${HABS_SHEET_WIDTH}px`,
    "--image-font-sheet-h": `${HABS_SHEET_HEIGHT}px`,
  };

  if (typeof scale === "number") {
    rootStyle["--image-font-scale"] = String(scale);
  }
  if (typeof gapRem === "number") {
    rootStyle["--image-font-gap"] = `${gapRem}rem`;
  }
  if (typeof spaceRem === "number") {
    rootStyle["--image-font-space"] = `${spaceRem}rem`;
  }

  return (
    <span className={`image-font-text${className ? ` ${className}` : ""}`} style={rootStyle} aria-label={ariaLabel ?? text}>
      {text.toUpperCase().split("").map((char, index) => {
        if (char === " ") {
          return <span key={`space-${index}`} className="image-font-space" aria-hidden="true" />;
        }

        if (char === ".") {
          return <span key={`dot-${index}`} className="image-font-dot" aria-hidden="true" />;
        }

        if (!isGlyphChar(char)) {
          return (
            <span key={`fallback-${index}`} className="image-font-fallback" aria-hidden="true">
              {char}
            </span>
          );
        }

        const glyph = HABS_GLYPHS[char];
        const glyphStyle = {
          "--glyph-w": `${glyph.w}px`,
          "--glyph-h": `${glyph.h}px`,
          "--glyph-x": `${-glyph.x}px`,
          "--glyph-y": `${-glyph.y}px`,
        } as CSSProperties & Record<string, string>;

        return <span key={`${char}-${index}`} className="image-font-char" style={glyphStyle} aria-hidden="true" />;
      })}
    </span>
  );
}
