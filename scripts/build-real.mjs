// Builds the public deployment using the real Welsford call: reads the
// committed snapshot (scripts/demo-assets/real-seed-data.json + real-call.mp3)
// and bakes it into dist/index.html as `window.__SEED__`, same mechanism as
// build-demo.mjs. Unlike build-preview.mjs, this doesn't hit localhost:8787 —
// the snapshot is static, so this builds fine on Vercel's remote servers.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function main() {
  const seedSource = JSON.parse(
    readFileSync(path.join(root, 'scripts', 'demo-assets', 'real-seed-data.json'), 'utf8')
  );
  const callId = Object.keys(seedSource.details)[0];
  const audioPath = path.join(root, 'scripts', 'demo-assets', 'real-call.mp3');
  const audioDataUri = `data:audio/mpeg;base64,${readFileSync(audioPath).toString('base64')}`;

  const seed = { ...seedSource, audio: { [callId]: audioDataUri } };

  console.log('Running vite build ...');
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });

  const indexPath = path.join(root, 'dist', 'index.html');
  let html = readFileSync(indexPath, 'utf8');
  const seedScript = `<script>window.__SEED__ = ${JSON.stringify(seed)};</script>\n  `;
  if (!html.includes('<script type="module"')) {
    throw new Error('Could not find the module script tag in dist/index.html to inject the seed before.');
  }
  html = html.replace('<script type="module"', `${seedScript}<script type="module"`);
  writeFileSync(indexPath, html);

  console.log(`Real-data build ready in dist/ (${(html.length / 1024 / 1024).toFixed(1)}MB index.html).`);
}

main();
