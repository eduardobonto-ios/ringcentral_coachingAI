// Manual runner for the RingCentral sync — the equivalent of processOne.ts for RC-sourced calls.
//
//   npm run rc:sync -- --dry-run              what would be ingested from the last 24h
//   npm run rc:sync -- --no-email --limit 10  ingest 10 calls, email nobody
//   npm run rc:sync -- --days 3               ingest 3 days AND email every agent
//
// Always start with --dry-run on a new account: it verifies auth, permissions and the
// extension->agent mapping without downloading audio or emailing anyone. Then --no-email to
// review the coaching in the admin UI. Only drop --no-email once you are sure the right
// people are on the list: sent mail cannot be recalled.
import 'dotenv/config';
import { syncRingCentral } from './ringcentralSync.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sendEmail = !args.includes('--no-email');
const limitArg = args.indexOf('--limit');
const limit = limitArg === -1 ? undefined : Number(args[limitArg + 1]);

if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
  console.error('--limit must be a positive number');
  process.exit(1);
}
const daysArg = args.indexOf('--days');
const days = daysArg === -1 ? 1 : Number(args[daysArg + 1]);

if (!Number.isFinite(days) || days <= 0) {
  console.error('--days must be a positive number');
  process.exit(1);
}

const until = new Date();
const since = new Date(until.getTime() - days * 24 * 3600_000);

console.log(`[rc-sync] ${dryRun ? 'DRY RUN — ' : ''}window ${since.toISOString()} -> ${until.toISOString()}`);
if (!dryRun) {
  console.log(`[rc-sync] emails: ${sendEmail ? 'WILL BE SENT to each agent' : 'suppressed (--no-email)'}${limit ? ` | limit: ${limit} calls` : ''}`);
}

syncRingCentral({ since, until, dryRun, sendEmail, limit })
  .then((r) => {
    console.log(`\nseen:     ${r.seen}`);
    console.log(`ingested: ${r.ingested}${dryRun ? ' (dry run — nothing written)' : ''}`);
    console.log('skipped: ', r.skipped);
    if (r.errors.length) console.log('errors:  ', r.errors);
  })
  .catch((e) => {
    console.error(`\n${e.message}`);
    process.exit(1);
  });
