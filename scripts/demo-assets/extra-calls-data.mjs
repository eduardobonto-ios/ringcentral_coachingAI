// Hand-written coaching analysis for the 5 synthetic demo calls (audio is
// TTS-generated, see gen_demo_calls.py notes in build-real.mjs). Turns and
// exact timestamps live in extra-calls/manifest.json, generated alongside
// the audio so they line up precisely; this file supplies everything else:
// scores, rationale, evidence, and the coaching email content.
const RUBRIC_VERSION = '2026.1';
const WEIGHTS = { empathy: 25, communication: 20, professionalism: 15, process: 20, resolution: 20 };

function overallScore(scores) {
  const total = scores.reduce((sum, s) => sum + s.score * WEIGHTS[s.key], 0);
  return Math.round(total / 100);
}

function bandFor(score) {
  if (score >= 80) return 'strong';
  if (score >= 40) return 'needs-improvement';
  return 'needs-intervention';
}

export const EXTRA_CALLS = [
  {
    id: 'demo-strong-01',
    recorded_at: '2026-09-08T14:20:00.000Z',
    agent_role: 'Customer Service Rep',
    agent_email: 'priya.anand@example.com',
    outcome: 'resolved',
    scores: [
      { key: 'empathy', label: 'Empathy', score: 95, rationale: "Immediately names the stress of a pump being down before asking any lookup questions.", evidence: [{ t: 8.8, quote: "Oh no, a pump down is stressful, especially if it's holding up a job. Let's get you sorted." }] },
      { key: 'communication', label: 'Communication', score: 90, rationale: 'Gives exact price and stock count instead of vague reassurance.', evidence: [{ t: 22.6, quote: 'Found it, the kit is nine dollars and twenty cents, and four in stock.' }] },
      { key: 'professionalism', label: 'Professionalism', score: 95, rationale: 'Warm and proactive throughout, no wasted motion.', evidence: [{ t: 44.4, quote: "I'll also email you the install sheet for that kit in case it helps." }] },
      { key: 'process', label: 'Process Adherence', score: 90, rationale: 'Looks up the part correctly, confirms stock, and offers the install sheet unprompted.', evidence: [{ t: 34.0, quote: "Yes, if we get it out in the next hour it'll go out same day." }] },
      { key: 'resolution', label: 'Issue Resolution', score: 90, rationale: 'Same-day shipping committed on the call; fully resolved.', evidence: [{ t: 34.0, quote: "you'll have tracking in your inbox before end of day" }] },
    ],
    strengths: [
      { title: 'Opened with empathy', detail: 'Named the stress of a pump being down before jumping into troubleshooting.' },
      { title: 'Proactive follow-through', detail: 'Offered the install sheet without being asked, and confirmed exact stock and price.' },
    ],
    improvements: [
      { title: 'Read the shipping address back', detail: 'Confirmed timing but never verified where the kit is headed, risking a wrong-address shipment.', instead: "\"if we get it out in the next hour it'll go out same day\"", say: '"I\'ve got it going to the address on file — still the right spot?"' },
    ],
    practiceAction: 'Add a one-line address confirmation before ending fast, high-trust calls like this.',
    flags: ['did not confirm shipping address'],
  },
  {
    id: 'demo-strong-02',
    recorded_at: '2026-09-07T09:05:00.000Z',
    agent_role: 'Customer Service Rep',
    agent_email: 'marcus.webb@example.com',
    outcome: 'resolved',
    scores: [
      { key: 'empathy', label: 'Empathy', score: 70, rationale: 'Polite and attentive; no distress to defuse so a lower weight here is expected.', evidence: [{ t: 7.7, quote: "We do, at that quantity you'd qualify for our contractor tier, twelve percent off list." }] },
      { key: 'communication', label: 'Communication', score: 85, rationale: 'States the exact discount and turnaround time.', evidence: [{ t: 18.1, quote: "I'll have a quote number back to you within the hour." }] },
      { key: 'professionalism', label: 'Professionalism', score: 95, rationale: 'Efficient and courteous throughout.', evidence: [{ t: 28.7, quote: 'Okay, found your account, I\'ll pull the part from your order history.' }] },
      { key: 'process', label: 'Process Adherence', score: 80, rationale: 'Uses order history instead of re-asking, but never confirms the quote destination.', evidence: [{ t: 28.7, quote: 'send the quote over' }] },
      { key: 'resolution', label: 'Issue Resolution', score: 85, rationale: 'Clear next step with a firm timeline, though the quote itself was not sent during the call.', evidence: [{ t: 18.1, quote: 'within the hour' }] },
    ],
    strengths: [
      { title: 'Quoted a concrete discount tier', detail: "Named the exact contractor-tier percentage instead of a vague 'we can work with you'." },
      { title: 'Used order history instead of re-asking', detail: 'Pulled the part from account history rather than making the customer repeat information.' },
    ],
    improvements: [
      { title: 'Confirm where the quote is going', detail: "Promised a quote 'within the hour' but never confirmed the email address to send it to.", instead: "\"I'll pull the part from your order history and send the quote over.\"", say: '"I\'ll send that quote to the email on file — still the best address for you?"' },
    ],
    practiceAction: "Before ending a call that ends in 'I'll send you X,' name the destination out loud.",
    flags: ['did not confirm delivery email'],
  },
  {
    id: 'demo-improve-01',
    recorded_at: '2026-09-06T17:40:00.000Z',
    agent_role: 'Customer Service Rep',
    agent_email: 'elena.torres@example.com',
    outcome: 'resolved',
    scores: [
      { key: 'empathy', label: 'Empathy', score: 55, rationale: "Doesn't engage with the customer's hesitation after saying the answer isn't reassuring.", evidence: [{ t: 27.7, quote: "That's not super reassuring, but okay, go ahead." }] },
      { key: 'communication', label: 'Communication', score: 45, rationale: "Gives a vague answer ('low stock', 'should be fine') instead of a concrete number.", evidence: [{ t: 11.4, quote: "I'm not totally sure, the system just says low stock, not an exact number." }] },
      { key: 'professionalism', label: 'Professionalism', score: 75, rationale: 'Stays polite even when pushed on the vague answer.', evidence: [{ t: 21.9, quote: "It should be fine, I'll put in the order." }] },
      { key: 'process', label: 'Process Adherence', score: 50, rationale: 'Places the order without verifying the actual stock count first.', evidence: [{ t: 21.9, quote: "if there's a problem someone will call you" }] },
      { key: 'resolution', label: 'Issue Resolution', score: 60, rationale: 'Order placed but real uncertainty about fulfillment is left hanging.', evidence: [{ t: 31.6, quote: "Alright, order's in." }] },
    ],
    strengths: [
      { title: 'Stayed polite under pushback', detail: "Didn't get defensive when the customer questioned the vague stock answer." },
    ],
    improvements: [
      { title: 'Get an exact stock number before promising', detail: "'Low stock' left the customer unsure whether their order would actually ship complete.", instead: "\"I'm not totally sure, the system just says low stock, not an exact number.\"", say: '"Let me check the exact count... I show 3 in stock, so your 2 are covered."' },
      { title: "Don't defer the confirmation to 'someone will call'", detail: 'Passing the uncertainty downstream leaves the customer without a real answer on the call.', instead: "\"It should be fine, I'll put in the order and if there's a problem someone will call you.\"", say: '"Let me confirm that count myself right now before we place it."' },
    ],
    practiceAction: 'When inventory shows a vague status, check the exact count before quoting availability.',
    flags: ['vague stock answer', 'did not confirm exact quantity available'],
  },
  {
    id: 'demo-improve-02',
    recorded_at: '2026-09-05T11:15:00.000Z',
    agent_role: 'Customer Service Rep',
    agent_email: 'devon.ashworth@example.com',
    outcome: 'unresolved',
    scores: [
      { key: 'empathy', label: 'Empathy', score: 40, rationale: "Says 'sorry about that' but never takes ownership of the shipping mistake.", evidence: [{ t: 7.1, quote: 'Okay, sorry about that.' }] },
      { key: 'communication', label: 'Communication', score: 65, rationale: 'Clear about the return process, at least.', evidence: [{ t: 17.7, quote: "I can't process returns from this line, it has to go through email." }] },
      { key: 'professionalism', label: 'Professionalism', score: 70, rationale: 'Stays calm despite the customer pushing back on the process.', evidence: [{ t: 26.2, quote: "I understand, but that's the process." }] },
      { key: 'process', label: 'Process Adherence', score: 45, rationale: "Hides behind 'that's the process' without offering any workaround or escalation.", evidence: [{ t: 17.7, quote: 'it has to go through email' }] },
      { key: 'resolution', label: 'Issue Resolution', score: 30, rationale: 'Resolves nothing on the call itself; pushes the whole problem to another channel.', evidence: [{ t: 29.3, quote: "Fine, I'll email them." }] },
    ],
    strengths: [
      { title: "Didn't get defensive", detail: 'Stayed even-toned even when the customer pushed back on the process.' },
    ],
    improvements: [
      { title: 'Own the mistake, not just apologize', detail: "'Sorry about that' is passive — this was a shipping error, not a neutral event.", instead: '"Okay, sorry about that."', say: '"That\'s on us — we sent the wrong part. Let\'s get this fixed."' },
      { title: 'Offer to start the fix now, not just point to email', detail: 'Telling the customer to email support after a shipping error puts the burden back on them.', instead: "\"I can't process returns from this line, it has to go through email.\"", say: '"I\'ll flag this internally right now and get the correct elbow fitting sent out — you can send the photo when convenient."' },
    ],
    practiceAction: 'For a shipping error, start the fix on the call before sending the customer to a separate channel.',
    flags: ['did not take ownership of error', 'no on-call resolution offered'],
  },
  {
    id: 'demo-intervention-01',
    recorded_at: '2026-09-04T08:30:00.000Z',
    agent_role: 'Customer Service Rep',
    agent_email: 'grant.michaels@example.com',
    outcome: 'lost',
    scores: [
      { key: 'empathy', label: 'Empathy', score: 15, rationale: "Near-flat response to 'plant shutdown' — never validates the urgency.", evidence: [{ t: 14.9, quote: "I hear you, but that's just not how shipping works here." }] },
      { key: 'communication', label: 'Communication', score: 30, rationale: 'Vague throughout, never explores what expediting would actually take.', evidence: [{ t: 6.8, quote: "Yeah, we don't really do same day." }] },
      { key: 'professionalism', label: 'Professionalism', score: 40, rationale: 'Not rude, but checked-out and passive under pressure.', evidence: [{ t: 24.8, quote: "You could try calling around to other suppliers." }] },
      { key: 'process', label: 'Process Adherence', score: 15, rationale: 'Never checks will-call, local pickup, or expedited freight despite being asked directly.', evidence: [{ t: 20.3, quote: 'Is there any option, expedited freight, will call, anything?' }] },
      { key: 'resolution', label: 'Issue Resolution', score: 5, rationale: 'Explicitly tells the customer to go elsewhere. Total loss.', evidence: [{ t: 24.8, quote: "I'm not sure we can help today." }] },
    ],
    strengths: [
      { title: 'Stayed on the line', detail: "Didn't hang up or cut the customer off despite the tense tone." },
    ],
    improvements: [
      { title: 'Never send a customer to a competitor', detail: "'Try calling around to other suppliers' hands the sale away instead of exhausting internal options first.", instead: '"You could try calling around to other suppliers, I\'m not sure we can help today."', say: '"Let me check will-call and expedited freight before we give up — one second."' },
      { title: 'Match urgency with urgency', detail: "A plant shutdown got the same flat tone as a routine question — nothing signaled this was being treated as a priority.", instead: "\"Yeah, we don't really do same day.\"", say: '"A shutdown is serious — let me see what we can do to get this to you today."' },
    ],
    practiceAction: "On any call where the customer says 'shutdown,' 'down,' or 'emergency,' escalate to a supervisor or check expedited options before answering.",
    flags: ['dismissed urgent request', 'directed customer to a competitor', 'no expedited shipping explored', 'call ended with customer lost'],
  },
];

export { overallScore, bandFor, RUBRIC_VERSION };
