// Vercel entrypoint for the coaching API.
//
// Vercel serves every file under /api as a function and resolves its imports from the ROOT
// package.json, which is why the server's runtime dependencies are listed there as well as in
// server/package.json (that one still drives local `npm run dev`).
//
// An Express app is already a (req, res) handler, so it can be exported directly.
//
// Requires Fluid compute enabled on the project: without it Hobby functions cap at 60s, and
// transcribing a long call takes longer than that. With it, Hobby allows 300s — see
// vercel.json's maxDuration.
import { app } from '../server/src/index.js';

export default app;
