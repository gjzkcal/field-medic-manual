// コントラストのテスト（contrast.test.ts）のための色の計算。index.css と Tailwind の色は OKLCH か 16 進で書いてある。
// 変換の式は CSS Color 4（OKLab → linear sRGB）、コントラストは WCAG 2.2 の相対輝度による

export interface Rgba {
  /** linear でない sRGB（0〜1） */
  r: number;
  g: number;
  b: number;
  a: number;
}

const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/;
const HEX = /^#([0-9a-f]{6})$/i;

export function parseColor(text: string): Rgba {
  const value = text.trim();
  const hex = HEX.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  const m = OKLCH.exec(value);
  if (m === null) {
    throw new Error(`読めない色: ${text}`);
  }
  const lightness = Number(m[1]) / (m[2] === "%" ? 100 : 1);
  const chroma = Number(m[3]);
  const hue = (Number(m[4]) * Math.PI) / 180;
  const alpha = m[5] === undefined ? 1 : Number(m[5]) / (m[6] === "%" ? 100 : 1);
  return { ...oklabToSrgb(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)), a: alpha };
}

function oklabToSrgb(l: number, a: number, b: number): Omit<Rgba, "a"> {
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ].map((c) => encode(Math.min(1, Math.max(0, c))));
  return { r: linear[0] ?? 0, g: linear[1] ?? 0, b: linear[2] ?? 0 };
}

function encode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function decode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 半透明の色を下の地に重ねた色（sRGB のまま混ぜる。ブラウザの既定の合成と同じ） */
export function over(top: Rgba, below: Rgba): Rgba {
  const mix = (x: number, y: number): number => x * top.a + y * (1 - top.a);
  return { r: mix(top.r, below.r), g: mix(top.g, below.g), b: mix(top.b, below.b), a: 1 };
}

/** color-mix(in oklch, color p%, transparent) は、色の不透明度を p% にしたものと同じ */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: color.a * alpha };
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** 2 色のコントラスト比。前景が半透明なら地に重ねてから測る */
export function contrast(foreground: Rgba, background: Rgba): number {
  const fg = luminance(over(foreground, background));
  const bg = luminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}
