// Create admin sign-in accounts.
//
//   npm run admins:create -- --dry-run 'jwelsford@fswelsford.com=J Welsford' gil@fswelsford.com
//   NEW_ADMIN_PASSWORD='...' npm run admins:create -- 'jwelsford@fswelsford.com=J Welsford'
//
// Sibling of createAgentUsers.ts, and deliberately not part of it: an agent must own a
// RingCentral extension or their calendar is empty forever, which is why that script refuses an
// address the roster does not know. An admin is the opposite case — they review other people's
// calls and usually make none of their own — so requiring an extension here would block exactly
// the accounts this is for.
//
// What "admin" means in this app is set out in requireCoachingRights (server/src/auth.ts): they
// see every agent's calls and every piece of coaching, and cannot request new coaching.
//
// The password is read from NEW_ADMIN_PASSWORD and never defaulted, so a shared starter password
// cannot end up committed here. Accounts are created with must_change_password = true; be aware
// nothing in the app enforces that flag yet — it records intent, it does not gate sign-in.
import 'dotenv/config';
import { supabaseAdmin, supabaseConfigured } from './supabaseClient.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

/** `email` or `email=Full Name`; without a name, the address's local part has to do. */
function parseTarget(arg: string): { email: string; name: string } {
  const [rawEmail, ...rest] = arg.split('=');
  const email = rawEmail.trim().toLowerCase();
  const given = rest.join('=').trim();
  const fallback = email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
  return { email, name: given || fallback };
}

const targets = args.filter((a) => !a.startsWith('--')).map(parseTarget);

if (!supabaseConfigured) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
  process.exit(1);
}
if (targets.length === 0) {
  console.error("Usage: npm run admins:create -- [--dry-run] <email>[='Full Name'] [<email> ...]");
  process.exit(1);
}
if (targets.some((t) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.email))) {
  console.error(`Not an email address: ${targets.find((t) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.email))!.email}`);
  process.exit(1);
}

const password = process.env.NEW_ADMIN_PASSWORD;
if (!dryRun && !password) {
  console.error("Set NEW_ADMIN_PASSWORD to the starter password, e.g.\n  NEW_ADMIN_PASSWORD='...' npm run admins:create -- <email>");
  process.exit(1);
}

console.log(`\n${targets.length} admin account(s):`);
for (const t of targets) console.log(`  ${t.email.padEnd(30)} ${t.name}`);

if (dryRun) {
  console.log('\nDry run — nothing was created.');
  process.exit(0);
}

console.log('');
for (const t of targets) {
  const { error } = await supabaseAdmin.auth.admin.createUser({
    email: t.email,
    password,
    email_confirm: true, // no mailbox round trip; these are provisioned, not self-signed-up
  });

  // Re-running must be safe: an account that already exists still gets its profile promoted,
  // because a half-finished first run is exactly when this script gets run twice.
  const existed = Boolean(error && /already/i.test(error.message));
  if (error && !existed) {
    console.error(`  FAIL  ${t.email.padEnd(30)} ${error.message}`);
    continue;
  }

  // handle_new_user() has already inserted the profile row with the default role; this promotes
  // it. `position` stays 'staff': position is about the org chart (who manages a department),
  // and an application admin is not a department manager.
  const { error: profileError, data: updated } = await supabaseAdmin
    .from('profiles')
    .update({ full_name: t.name, role: 'admin', position: 'staff', must_change_password: true })
    .eq('email', t.email)
    .select('email');

  const what = existed ? 'already registered' : 'created';
  console.log(
    profileError || !updated?.length
      ? `  PART  ${t.email.padEnd(30)} user ${what}, profile update failed: ${profileError?.message ?? 'no row matched'}`
      : `  OK    ${t.email.padEnd(30)} ${t.name.padEnd(16)} (${what}, role=admin)`,
  );
}

console.log('\nDone. Each admin signs in with their email and the starter password, sees every agent, and cannot request coaching.');
