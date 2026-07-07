// One-off extraction of the Hermes artwork embedded as base64 data-URLs in
// legacy/index.html. Writes real .jpg files to src/assets/hermes/.
//
//   node scripts/extract-hermes.mjs
//
// Legacy const -> style name:
//   HERMES_ICON / HERMES_POSES                 -> vase
//   HERMES_ICON_ALT / HERMES_POSES_ALT         -> fresco
//   HERMES_ICON_AMPHORA / HERMES_POSES_AMPHORA -> amphora

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'legacy', 'index.html'), 'utf8');
const outDir = join(root, 'src', 'assets', 'hermes');
mkdirSync(outDir, { recursive: true });

const STYLES = [
  { style: 'vase', icon: 'HERMES_ICON', poses: 'HERMES_POSES' },
  { style: 'fresco', icon: 'HERMES_ICON_ALT', poses: 'HERMES_POSES_ALT' },
  { style: 'amphora', icon: 'HERMES_ICON_AMPHORA', poses: 'HERMES_POSES_AMPHORA' },
];

function writeJpeg(name, base64) {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`${name}: decoded data is not a JPEG`);
  }
  writeFileSync(join(outDir, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}

for (const { style, icon, poses } of STYLES) {
  const iconMatch = html.match(
    new RegExp(`const ${icon} = 'data:image/jpeg;base64,([^']+)'`)
  );
  if (!iconMatch) throw new Error(`could not find const ${icon}`);
  writeJpeg(`${style}-icon.jpg`, iconMatch[1]);

  const blockMatch = html.match(
    new RegExp(`const ${poses} = \\{([\\s\\S]*?)\\};`)
  );
  if (!blockMatch) throw new Error(`could not find const ${poses}`);

  const entryRe = /(\w+): 'data:image\/jpeg;base64,([^']+)'/g;
  let count = 0;
  for (const m of blockMatch[1].matchAll(entryRe)) {
    writeJpeg(`${style}-${m[1]}.jpg`, m[2]);
    count += 1;
  }
  if (count === 0) throw new Error(`no pose entries found in ${poses}`);
}

console.log('done');
