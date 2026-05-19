import { cp, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

await mkdir(dist, { recursive: true });

for (const file of ['metadata.json', 'explanations.json', 'videos.json']) {
  const source = path.join(root, file);
  if (existsSync(source)) {
    await copyFile(source, path.join(dist, file));
  }
}

for (let year = 2014; year <= 2025; year += 1) {
  const source = path.join(root, String(year));
  if (existsSync(source)) {
    await cp(source, path.join(dist, String(year)), { recursive: true });
  }
}
