// Run once: node public/generate-icons.mjs
// Generates icon-192.png and icon-512.png using canvas

import { createCanvas } from "canvas";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0D0D0D";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Red circle
  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.3;
  ctx.fillStyle = "#EF4444";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // "R" letter
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${size * 0.32}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("R", cx, cy + size * 0.02);

  return canvas.toBuffer("image/png");
}

writeFileSync(join(__dirname, "icon-192.png"), drawIcon(192));
writeFileSync(join(__dirname, "icon-512.png"), drawIcon(512));
console.log("Icons generated ✓");
