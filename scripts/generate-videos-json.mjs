import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [videoRootArg, baseUrlArg, remotePrefixArg] = process.argv.slice(2);
const videoRoot = videoRootArg || '/home/eason/CCC';
const baseUrl = (baseUrlArg || process.env.VIDEO_BASE_URL || '').replace(/\/$/, '');
const remotePrefix = (remotePrefixArg || process.env.VIDEO_REMOTE_PREFIX || '').replace(/^\/|\/$/g, '');

if (!baseUrl) {
  console.error('Usage: node scripts/generate-videos-json.mjs /home/eason/CCC https://your-public-r2-domain [optional-remote-prefix]');
  process.exit(1);
}

const videos = {};

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    const match = entry.name.match(/^CCC(\d{4})Q(\d{2})\.mp4$/i);
    if (!match) continue;

    const [, year, questionText] = match;
    const question = Number(questionText);
    const relative = path.relative(videoRoot, fullPath).split(path.sep).join('/');
    const remotePath = remotePrefix ? `${remotePrefix}/${relative}` : relative;
    const id = `${year}-${question}`;

    videos[id] = {
      title: `${year} Q${question} 讲解`,
      url: `${baseUrl}/${remotePath}`
    };
  }
}

await walk(videoRoot);

const sorted = Object.fromEntries(
  Object.entries(videos).sort(([a], [b]) => {
    const [yearA, questionA] = a.split('-').map(Number);
    const [yearB, questionB] = b.split('-').map(Number);
    return yearA - yearB || questionA - questionB;
  })
);

await writeFile('videos.json', `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote videos.json with ${Object.keys(sorted).length} videos`);
