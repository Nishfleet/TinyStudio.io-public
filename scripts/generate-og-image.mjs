// Regenerates public/og-image.png, the social share card (dogfood
// d87d715be3d0, "Social share image incomplete on home").
//
// The first og-image.png (PR #6) was built when the root page was the retired
// Agent Desk, so its copy advertised the legacy product. This generator keeps
// the card truthful and regenerable: site palette (index.css vars), the
// existing logo mark (favicon.svg), and copy taken verbatim from
// public/index.html — no new claims. Run it whenever the home page's headline
// or description changes:
//
//   node scripts/generate-og-image.mjs [output-path]   # default: public/og-image.png
//
// The output is rendered in real Chromium (the site's own engine) at exactly
// 1200x630 and verified before writing: Google Fonts must load, every element
// box must sit inside the canvas, and the pixels must contain the site's
// cream background, ink text, and brass accents. scripts/check-site.mjs also
// refuses any page whose og:image is not this file at 1200x630.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,200;0,9..144,300;0,9..144,400;1,9..144,200;1,9..144,300&family=Karla:wght@300;400;500;600;700&display=swap";

// Copy blocks below must stay verbatim matches of public/index.html.
const HEADLINE = "Most of them leave <em>before they ever get in touch.</em>";
const DESCRIPTION =
  "TinyStudio: the free leak audit of high-ticket service homepages. Each fault named in order of what it costs you, with the fix beside it. Six a month.";

const CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_URL}">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{
    font-family:'Karla',sans-serif;
    background:linear-gradient(135deg,#F6F0E5 0%,#F1E9DB 55%,#EBE1CF 100%);
    padding:64px 72px 56px;
    display:flex;flex-direction:column;
  }
  .glow{
    position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(60% 90% at 88% 8%,rgba(201,165,102,.20),transparent 68%);
  }
  .top{display:flex;align-items:center;gap:22px}
  .mark{width:64px;height:64px;flex:none}
  .wordmark{font-family:'Fraunces',serif;font-weight:400;font-size:46px;letter-spacing:-.5px}
  .wordmark .tiny{color:#191410}
  .wordmark .studio{color:#A47E3C}
  .orn{display:flex;align-items:center;gap:15px;margin:34px 0 26px;color:#A47E3C}
  .orn i{display:block;width:96px;height:1px;background:linear-gradient(90deg,transparent,#C9A566)}
  .orn i:last-child{background:linear-gradient(90deg,#C9A566,transparent)}
  .orn b{width:5px;height:5px;transform:rotate(45deg);background:#A47E3C;display:block}
  h1{font-family:'Fraunces',serif;font-weight:400;font-size:58px;line-height:1.16;color:#191410;max-width:980px}
  h1 em{font-style:italic;color:#A47E3C}
  .body{margin-top:26px;font-size:25px;line-height:1.55;color:#5E5346;max-width:880px}
  .foot{margin-top:auto;padding-top:34px;display:flex;align-items:center;gap:14px;
    font-size:19px;letter-spacing:.16em;text-transform:uppercase;color:#8A7C6B}
  .foot b{width:5px;height:5px;transform:rotate(45deg);background:#C9A566;display:block}
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="top">
    <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#171713"/>
      <path d="M16 18h32v9H36v20h-9V27H16z" fill="#fffdf7"/>
      <path d="M43 42l5 5 9-13" fill="none" stroke="#0d8f66" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="wordmark"><span class="tiny">Tiny</span><span class="studio">Studio</span></span>
  </div>
  <div class="orn"><i></i><b></b><i></i></div>
  <h1>${HEADLINE}</h1>
  <p class="body">${DESCRIPTION}</p>
  <div class="foot"><b></b><span>tinystudio.io&nbsp;&nbsp;·&nbsp;&nbsp;The Website Appraisal</span></div>
</body>
</html>`;

const outPath = process.argv[2] || "public/og-image.png";
const out = new URL(`../${outPath}`, import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(CARD_HTML, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const domCheck = await page.evaluate(() => {
  const box = (sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    fonts: { fraunces: document.fonts.check("58px Fraunces"), karla: document.fonts.check("25px Karla") },
    viewport: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    headline: box("h1"), body: box(".body"), foot: box(".foot"), wordmark: box(".wordmark")
  };
});
if (!domCheck.fonts.fraunces || !domCheck.fonts.karla) throw new Error("Google Fonts did not load");
if (domCheck.viewport.w > 1200 || domCheck.viewport.h > 630) throw new Error("Card overflows the 1200x630 canvas");
for (const [name, r] of [["headline", domCheck.headline], ["body", domCheck.body], ["foot", domCheck.foot], ["wordmark", domCheck.wordmark]]) {
  if (r.x < 0 || r.y < 0 || r.x + r.w > 1200 || r.y + r.h > 630) throw new Error(`${name} box escapes the canvas`);
}

const tmp = "/tmp/opencode/og-image-regen.png";
await page.screenshot({ path: tmp });
await browser.close();

// ---- on-disk verification: PNG signature, dims, and pixel sampling -------
const png = readFileSync(tmp);
if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error("Not a PNG");
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== 1200 || height !== 630) throw new Error(`Expected 1200x630, got ${width}x${height}`);

let idat = Buffer.alloc(0);
for (let o = 8; o < png.length; ) {
  const len = png.readUInt32BE(o);
  const type = png.subarray(o + 4, o + 8).toString("latin1");
  if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(o + 8, o + 8 + len)]);
  if (type === "IEND") break;
  o += 12 + len;
}
const raw = zlib.inflateSync(idat);
const bpp = 3;
const stride = width * bpp;
const pixels = Buffer.alloc(stride * height);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
let p = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[p++];
  for (let x = 0; x < stride; x++) {
    const rawByte = raw[p++];
    const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
    const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
    const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
    pixels[y * stride + x] =
      filter === 0 ? rawByte
      : filter === 1 ? rawByte + a
      : filter === 2 ? rawByte + b
      : filter === 3 ? rawByte + ((a + b) >> 1)
      : filter === 4 ? rawByte + paeth(a, b, c)
      : rawByte;
  }
}
const px = (x, y) => { const i = y * stride + x * bpp; return [pixels[i], pixels[i + 1], pixels[i + 2]]; };
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const near = ([r, g, b], [er, eg, eb], tol = 40) => Math.abs(r - er) <= tol && Math.abs(g - eg) <= tol && Math.abs(b - eb) <= tol;

let ink = 0, brass = 0, cream = 0;
for (let y = 20; y < height - 20; y += 3) {
  for (let x = 20; x < width - 20; x += 3) {
    const pxl = px(x, y);
    if (lum(pxl) < 70) ink++;
    else if (near(pxl, [0xa4, 0x7e, 0x3c]) || near(pxl, [0xc9, 0xa5, 0x66])) brass++;
    else if (lum(pxl) > 200) cream++;
  }
}
if (ink < 200) throw new Error("No ink (text) pixels found — card looks blank");
if (brass < 50) throw new Error("No brass accent pixels found");
if (!near(px(10, 10), [0xf1, 0xe9, 0xdb]) || cream < 20000) throw new Error("Background is not the site's cream palette");

writeFileSync(out, png);
console.log(`Wrote ${outPath} (${width}x${height}, ${png.length} bytes). Ink ${ink}, brass ${brass}, cream ${cream} sample pixels.`);
