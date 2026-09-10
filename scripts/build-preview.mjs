// Builds a static, read-only preview: fetches live data from the local
// coaching API (must be running on :8787), bakes it into dist/index.html as
// `window.__SEED__`, and inlines each call's audio as a data URI. src/api.ts
// reads from that seed instead of calling the server when it's present, so
// the resulting dist/ needs no backend and is safe to deploy as static files.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = 'http://localhost:8787';

const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  console.log(`Fetching data from ${API} ...`);
  const { calls } = await getJson(`${API}/api/calls`);
  const rubric = await getJson(`${API}/api/rubric`);

  const details = {};
  const emails = {};
  const audio = {};

  for (const call of calls) {
    details[call.id] = await getJson(`${API}/api/calls/${call.id}`);

    if (call.email_status) {
      const res = await fetch(`${API}/api/calls/${call.id}/email`);
      if (res.ok) emails[call.id] = await res.text();
    }

    const audioPath = path.join(root, 'server', 'audio', details[call.id].audio_path.split('/').pop());
    if (existsSync(audioPath)) {
      const ext = path.extname(audioPath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const b64 = readFileSync(audioPath).toString('base64');
      audio[call.id] = `data:${mime};base64,${b64}`;
    } else {
      console.warn(`  no audio file for call ${call.id} (${audioPath}), skipping`);
    }
  }

  const seed = { calls, details, rubric, emails, audio };
  console.log(`Baked ${calls.length} call(s), ${Object.keys(emails).length} email(s), ${Object.keys(audio).length} audio file(s).`);

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

  console.log(`Preview build ready in dist/ (${(html.length / 1024 / 1024).toFixed(1)}MB index.html).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
