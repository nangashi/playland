/**
 * PWA のアイコン（public/icons/*.png）を作る。画像ツールに頼らず、図形を直接塗って PNG に書き出す。
 *
 *   pnpm icons
 *
 * 図柄は、アクセント色（styles.css の --accent）の地に白い地図のピン。
 * - icon-*.png：角を丸めた四角（角は透過）
 * - maskable-*.png：全面を塗り、ピンを中央の安全領域（直径 80%）に収める（Android が丸や角丸に切り抜く）
 * - apple-touch-icon.png：全面を塗る（iOS が角を丸める。透過は黒くなるため使わない）
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const BG: Rgb = [0x0f, 0x6e, 0x66];
const FG: Rgb = [0xff, 0xff, 0xff];
const OUT_DIR = join(import.meta.dirname, "../../public/icons");
/** 1 画素あたりの縦横の標本数（輪郭のなめらかさ） */
const SAMPLES = 4;

type Rgb = [number, number, number];

interface Variant {
  file: string;
  size: number;
  /** 角の丸み（一辺に対する比）。null なら全面を塗る */
  cornerRadius: number | null;
  /** ピンの高さ（一辺に対する比） */
  pinHeight: number;
}

const variants: Variant[] = [
  { file: "icon-192.png", size: 192, cornerRadius: 0.22, pinHeight: 0.62 },
  { file: "icon-512.png", size: 512, cornerRadius: 0.22, pinHeight: 0.62 },
  { file: "maskable-192.png", size: 192, cornerRadius: null, pinHeight: 0.5 },
  { file: "maskable-512.png", size: 512, cornerRadius: null, pinHeight: 0.5 },
  { file: "apple-touch-icon.png", size: 180, cornerRadius: null, pinHeight: 0.6 },
];

/** 単位正方形（0〜1）の点が、地（角丸の四角）の内側か */
function inBackground(x: number, y: number, cornerRadius: number | null): boolean {
  if (cornerRadius === null) return true;
  const r = cornerRadius;
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

/** 単位正方形の点が、ピン（円と、円に接する 2 本の線で作る先端。中に穴）の内側か */
function inPin(x: number, y: number, pinHeight: number): boolean {
  // ピンの高さ = 円の半径 r + 中心から先端までの距離 d。d = 1.7r とする
  const r = pinHeight / 2.7;
  const d = 1.7 * r;
  // 見た目の重心がそろうよう、円と先端の中間を正方形の中心に置く
  const cx = 0.5;
  const cy = 0.5 - (d - r) / 2;
  const hole = 0.42 * r;
  const px = x - cx;
  const py = y - cy;
  const dist2 = px * px + py * py;
  if (dist2 <= hole * hole) return false;
  if (dist2 <= r * r) return true;
  // 先端から見て、中心方向との角度が接線の角度以内で、接点より先端側なら内側
  const vx = px;
  const vy = d - py; // 先端から上向きの成分
  const axial = vy;
  if (axial <= 0 || axial > (d * d - r * r) / d) return false;
  const sinA = r / d;
  const tanA = sinA / Math.sqrt(1 - sinA * sinA);
  return Math.abs(vx) <= axial * tanA;
}

function render(v: Variant): Buffer {
  const { size } = v;
  const rgba = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (col + (sx + 0.5) / SAMPLES) / size;
          const y = (row + (sy + 0.5) / SAMPLES) / size;
          if (!inBackground(x, y, v.cornerRadius)) continue;
          bg++;
          if (inPin(x, y, v.pinHeight)) fg++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const i = (row * size + col) * 4;
      // 白の割合で地の色と混ぜ、地の割合を不透明度にする
      const t = bg === 0 ? 0 : fg / bg;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c]! * (1 - t) + FG[c]! * t);
      rgba[i + 3] = Math.round((bg / total) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  // 各行の先頭にフィルタ種別 0（なし）を付ける
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

await mkdir(OUT_DIR, { recursive: true });
for (const v of variants) {
  await writeFile(join(OUT_DIR, v.file), render(v));
  console.log(`public/icons/${v.file}`);
}
