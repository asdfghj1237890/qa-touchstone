// Rasterize the brand master SVG → 1024px PNG, then hand it to `tauri icon`.
// Usage: node scripts/gen-icons.mjs   (then: npx tauri icon src-tauri/icons/source.png)
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';

const svg = fs.readFileSync('src-tauri/icons/source.svg', 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
fs.writeFileSync('src-tauri/icons/source.png', png);
console.log('wrote src-tauri/icons/source.png', png.length, 'bytes (1024x1024)');
