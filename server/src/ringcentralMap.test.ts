// Fixture tests for the RingCentral -> coaching mapping.
//
// The fixtures were rebuilt 2026-09-23 from ValveMan's live call log after the first real
// probe showed the inferred shapes were wrong in two ways that both failed silently.
// Run: npm test (from server/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentExtensionId,
  isCoachable,
  toAgent,
  directionOf,
  externalIdOf,
  recordingFilename,
  extensionIndex,
  MIN_COACHABLE_SEC,
} from './ringcentralMap.js';
import { hasNextPage } from './ringcentral.js';
import type { RcCallRecord, RcExtension } from './ringcentral.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

const callLog = load('call-log.json') as { records: RcCallRecord[]; paging: unknown; navigation?: unknown };
const byId = (id: string) => callLog.records.find((r) => r.id === id)!;

// Mirrors the filtering fetchExtensions() applies to the raw roster.
const extensions: RcExtension[] = (load('extensions.json').records as any[])
  .filter((r) => r.contact?.email)
  .map((r) => ({
    id: String(r.id),
    extensionNumber: String(r.extensionNumber),
    name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' '),
    email: r.contact.email,
    jobTitle: r.contact.jobTitle || undefined,
  }));

// --- agent attribution -------------------------------------------------------------------

test('outbound calls attribute via the top-level extension', () => {
  assert.equal(agentExtensionId(byId('outbound-coachable')), '62002');
});

test('a numeric extension id is coerced to a string', () => {
  // The live API returns extension.id as a NUMBER; the roster is keyed by string.
  const record = byId('outbound-coachable');
  assert.equal(typeof record.extension!.id, 'number');
  assert.equal(agentExtensionId(record), '62002');
});

test('outbound falls back to from.extensionId when the top level is absent', () => {
  const record = { ...byId('outbound-coachable') };
  delete record.extension;
  assert.equal(agentExtensionId(record), '62002');
});

test('INBOUND calls attribute via the answering leg', () => {
  // Regression: inbound records carry no top-level extension and no to.extensionId. Reading
  // only the top level dropped every inbound call — a third of recorded volume — in silence.
  const record = byId('inbound-coachable-via-legs');
  assert.equal(record.extension, undefined, 'fixture must mirror the live shape');
  assert.equal(record.to?.extensionId, undefined, 'fixture must mirror the live shape');
  assert.equal(agentExtensionId(record), '62001');
});

test('the ring-group leg is skipped in favour of the leg that answered', () => {
  const record = byId('inbound-coachable-via-legs');
  assert.equal(record.legs![0].extension, undefined, 'first leg is the ring group');
  assert.equal(agentExtensionId(record), '62001', 'must pick the agent leg, not the group leg');
});

test('a call answered only by a ring group resolves to that group, which has no agent', () => {
  const extId = agentExtensionId(byId('inbound-ring-group-only'));
  assert.equal(extId, '69999');
  assert.equal(extensionIndex(extensions).get(extId!), undefined, 'must not map to a coachable agent');
});

test('a call with no extension anywhere attributes to nobody', () => {
  const record: RcCallRecord = { id: 'x', startTime: '2026-09-21T00:00:00.000Z', duration: 100, direction: 'Inbound' };
  assert.equal(agentExtensionId(record), null);
});

// --- pagination --------------------------------------------------------------------------

test('pagination stops when navigation.nextPage is absent', () => {
  // Regression: the live `paging` object has NO totalPages, so `page >= totalPages` compared
  // against undefined, was always false, and paginated forever — draining the rate budget.
  assert.equal((callLog.paging as any).totalPages, undefined, 'live paging really has no totalPages');
  assert.equal(hasNextPage(callLog as any), false, 'last page must terminate the loop');
});

test('pagination continues while navigation.nextPage is present', () => {
  assert.equal(hasNextPage({ navigation: { nextPage: { uri: 'https://…' } } }), true);
  assert.equal(hasNextPage({ navigation: {} }), false);
  assert.equal(hasNextPage({}), false);
});

// --- coachability ------------------------------------------------------------------------

test('coachable calls are voice, recorded, and long enough to contain a conversation', () => {
  assert.equal(isCoachable(byId('inbound-coachable-via-legs')), true);
  assert.equal(isCoachable(byId('outbound-coachable')), true);
});

test('unrecorded, too-short and non-voice calls are not coachable', () => {
  assert.equal(isCoachable(byId('no-recording')), false, 'no recording');
  assert.equal(isCoachable(byId('too-short')), false, 'under the duration floor');
  assert.equal(isCoachable(byId('fax')), false, 'fax, not a call');
});

test('the duration floor is inclusive at the boundary', () => {
  const base = byId('outbound-coachable');
  assert.equal(isCoachable({ ...base, duration: MIN_COACHABLE_SEC }), true);
  assert.equal(isCoachable({ ...base, duration: MIN_COACHABLE_SEC - 1 }), false);
});

// --- identity and naming -----------------------------------------------------------------

test('external id is keyed on the recording so repeat syncs dedupe', () => {
  assert.equal(externalIdOf(byId('inbound-coachable-via-legs')), 'rc:rec-9001');
});

test('external id falls back to the call id when a recording id is missing', () => {
  assert.equal(externalIdOf(byId('no-recording')), 'rc:no-recording');
});

test('extensions map to agents, defaulting the role when RingCentral has no job title', () => {
  const index = extensionIndex(extensions);
  assert.deepEqual(toAgent(index.get('62001')!), {
    id: '62001',
    name: 'Maria Santos',
    email: 'maria@valveman.com',
    role: 'Inside Sales Rep',
  });
  assert.equal(toAgent(index.get('62002')!).role, 'Customer Service Rep');
});

test('direction is normalized to the pipeline vocabulary', () => {
  assert.equal(directionOf(byId('inbound-coachable-via-legs')), 'inbound');
  assert.equal(directionOf(byId('outbound-coachable')), 'outbound');
  assert.equal(directionOf({ id: 'x', startTime: '', duration: 0 }), 'unknown');
});

test('recording filenames are filesystem-safe and collision-free', () => {
  const name = recordingFilename(byId('inbound-coachable-via-legs'));
  assert.equal(name, 'rc-rec-9001-2026-09-21T02-14-07-000Z.mp3');
  assert.ok(!/[:]/.test(name), 'colons break on some filesystems and in URLs');
  assert.notEqual(name, recordingFilename(byId('outbound-coachable')));
});

test('the fixture roster drops extensions with no email', () => {
  assert.equal(extensions.length, 2, 'the ring group has no contact email and must be filtered out');
});
