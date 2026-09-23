// Create sign-in accounts for coaching agents.
//
//   npm run agents:create -- --dry-run dylan@valveman.com amr@valveman.com
//   NEW_AGENT_PASSWORD='...' npm run agents:create -- dylan@valveman.com amr@valveman.com
//
// Every email must belong to a RingCentral extension, and the script refuses any that does not.
// That check is the whole point rather than a nicety: the app scopes an agent to their own calls
// by matching their profile email against the email RingCentral holds for their extension (see
// visibleTo() in ringcentralOnDemand.ts). An account created under any other address — a
// personal address, or a shared mailbox like support2@ — signs in fine and then shows an empty
// calendar forever, with nothing to indicate why.
//
// Name and job title come from the RingCentral roster for the same reason: one source of truth.
//
// The password is read from NEW_AGENT_PASSWORD and never defaulted, so a shared starter password
// cannot end up committed here. Accounts are created with must_change_password = true, but be
// aware nothing in the app enforces that flag yet — it records intent, it does not gate sign-in.
import 'dotenv/config';
import { supabaseAdmin, supabaseConfigured } from './supabaseClient.js';
import { fetchExtensionsCached } from './ringcentral.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const emails = args.filter((a) => !a.startsWith('--')).map((e) => e.toLowerCase());

if (!supabaseConfigured) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
  process.exit(1);
}
if (emails.length === 0) {
  console.error('Usage: npm run agents:create -- [--dry-run] <email> [<email> ...]');
  process.exit(1);
}

const password = process.env.NEW_AGENT_PASSWORD;
if (!dryRun && !password) {
  console.error('Set NEW_AGENT_PASSWORD to the starter password, e.g.\n  NEW_AGENT_PASSWORD=\'...\' npm run agents:create -- <email>');
  process.exit(1);
}

const roster = await fetchExtensionsCached();
const byEmail = new Map(roster.map((e) => [e.email.toLowerCase(), e]));

// Resolve everything before writing anything: a half-provisioned team is worse than none.
const planned: { email: string; name: string; title: string; extensionId: string }[] = [];
let blocked = 0;

for (const email of emails) {
  const ext = byEmail.get(email);
  if (!ext) {
    console.error(`  SKIP  ${email} — no RingCentral extension has this address, so this account would see no calls.`);
    blocked++;
    continue;
  }
  planned.push({ email, name: ext.name, title: ext.jobTitle || 'Customer Service Rep', extensionId: ext.id });
}

console.log(`\n${planned.length} account(s) to create${blocked ? `, ${blocked} skipped` : ''}:`);
for (const p of planned) console.log(`  ${p.email.padEnd(26)} ${p.name.padEnd(18)} ext ${p.extensionId}  (${p.title})`);

if (dryRun) {
  console.log('\nDry run — nothing was created.');
  process.exit(0);
}

console.log('');
for (const p of planned) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: p.email,
    password,
    email_confirm: true, // no mailbox round trip; these are provisioned, not self-signed-up
  });

  if (error || !data.user) {
    console.error(`  FAIL  ${p.email.padEnd(26)} ${error?.message ?? 'no user returned'}`);
    continue;
  }

  // handle_new_user() has already inserted a blank profile; fill in what it cannot know.
  // role stays 'employee': these are agents, and an agent must not see the whole account.
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ full_name: p.name, role: 'employee', position: 'staff', must_change_password: true })
    .eq('id', data.user.id);

  console.log(
    profileError
      ? `  PART  ${p.email.padEnd(26)} user created, profile update failed: ${profileError.message}`
      : `  OK    ${p.email.padEnd(26)} ${p.name}`,
  );
}

console.log('\nDone. Each agent signs in with their email and the starter password, and sees only their own calls.');
