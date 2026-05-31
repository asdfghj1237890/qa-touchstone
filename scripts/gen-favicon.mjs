// Build public/favicon.ico (multi-size) from the brand PNGs that `tauri icon`
// generated, so the legacy .ico fallback matches the SVG favicon + app icon.
import pngToIco from 'png-to-ico';
import fs from 'node:fs';

const buf = await pngToIco([
  'src-tauri/icons/32x32.png',
  'src-tauri/icons/64x64.png',
  'src-tauri/icons/128x128.png',
]);
fs.writeFileSync('public/favicon.ico', buf);
console.log('wrote public/favicon.ico', buf.length, 'bytes (32/64/128)');
