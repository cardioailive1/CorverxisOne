// ═════════════════════════════════════════════════════════════════════════════
// CorverxisONE → NexGen AI Gateway  (multi-plant aware)
// Drop this route into whichever backend serves CorverxisONE.html and its
// /api/v1/* and /api/erp/* endpoints. It is the server-side counterpart to
// the callNexGenAI() helper used by all 8 AI features in the dashboard
// (AI Copilot Insights, Live Console, 8D generation, PPAP assembly, FMEA
// generation, shift reports, predictive maintenance reports, compliance
// reports).
//
// ── THE TWO-LEVEL IDENTITY MODEL ──────────────────────────────────────────────
// If more than one plant runs CorverxisONE, "who is asking" has two parts
// that both need to reach NexGen, not just one:
//
//   NexGen API Key   → identifies the PLANT / organization
//   external_user_id → identifies the EMPLOYEE within that plant
//
// Each plant gets its OWN nxg-... API key (generate one per plant in the
// Lab → API Dev → Keys — this reuses infrastructure that already exists,
// nothing new to build there). That key is what NexGen's existing
// per-key revocation, audit, and usage tracking already operates on, so
// "cut off Plant B without touching Plant A" is just revoking Plant B's key.
//
// Within a plant's key, external_user_id further isolates each employee's
// memory and audit trail — built last iteration, unchanged here. NexGen
// combines both into one composite scoping key server-side:
//   {plant's nxg key}::{employee id}
// So "Sarah at the Detroit plant" and "Sarah at the Toronto plant" (even if
// they somehow shared an email) can never collide — they're under
// completely different plant keys to begin with.
//
// WHY THIS EXISTS AT ALL:
// The dashboard originally called https://api.anthropic.com/v1/messages
// directly from the browser with no API key attached — it would have 401'd
// in any real deployment (the code's own error message even said "Ensure
// API keys are configured"). This route fixes that AND adds the two-level
// scoping above, entirely server-side — no key of any kind ever reaches
// the browser.
//
// WHAT THIS BUYS YOU:
//   - PROOF eval coverage (test these exact prompts in the golden set)
//   - Per-plant AND per-employee isolated memory + audit trail
//   - Per-plant revocation, using the Lab's existing API key management —
//     no new admin tooling required
//   - Grounding & verification, deterministic-mode caching, full reasoning
//     logs — all inherited automatically, same as any other NexGen traffic
//
// ── SETUP ──────────────────────────────────────────────────────────────────
//   1. In the Lab → API Dev → Keys, generate ONE key per plant, e.g.:
//        "CorverxisONE — Detroit Plant"   → nxg-aaa111...
//        "CorverxisONE — Toronto Plant"   → nxg-bbb222...
//
//   2. Add to this backend's .env — a JSON map of plant id → key:
//        NEXGEN_API_URL=https://nexgen-frontier-lab.onrender.com
//        NEXGEN_PLANT_KEYS={"detroit":"nxg-aaa111...","toronto":"nxg-bbb222..."}
//        NEXGEN_API_KEY=nxg-...          (fallback — used only if a user's
//                                          plant isn't found in the map above,
//                                          or for single-plant deployments
//                                          that don't need per-plant keys yet)
//
//   3. Point the plant/employee resolution below at however this backend
//      already knows which plant and user is logged in.
//
//   4. Add this route to your Express app:
//        app.use('/api/ai', require('./routes/corverxis-ai-gateway'));
//
//   5. Requires Node 18+ (built-in fetch) or `npm install node-fetch` and
//      uncomment the require line below for older Node versions.
// ═════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

// const fetch = require('node-fetch');   // uncomment if on Node < 18

const NEXGEN_API_URL = process.env.NEXGEN_API_URL || 'https://nexgen-frontier-lab.onrender.com';

// ── Per-plant key map ──────────────────────────────────────────────────────
// NEXGEN_PLANT_KEYS is a JSON object: { "<plant_id>": "nxg-...", ... }
// Falls back to NEXGEN_API_KEY (a single shared key) if a plant isn't found
// in the map, or if the map isn't configured at all — so this still works
// unmodified for a single-plant deployment.
let _plantKeyMap = {};
try {
  _plantKeyMap = JSON.parse(process.env.NEXGEN_PLANT_KEYS || '{}');
} catch (err) {
  console.error('NEXGEN_PLANT_KEYS is not valid JSON — ignoring it and using NEXGEN_API_KEY for all plants:', err.message);
}
const FALLBACK_API_KEY = process.env.NEXGEN_API_KEY || null;

function resolveApiKeyForPlant(plantId) {
  if (plantId && _plantKeyMap[plantId]) return _plantKeyMap[plantId];
  return FALLBACK_API_KEY;
}

router.post('/query', async (req, res) => {
  const { system, prompt, max_tokens, domain } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  // ── Resolve WHO is asking — plant first, then employee within it ─────────
  // callNexGenAI() on the frontend sends `credentials: 'same-origin'`, so
  // this backend already has the logged-in employee's session available on
  // req — the same way it already knows who to authorize for /api/v1/* and
  // /api/erp/*. Point these two lines at however this backend's real auth
  // actually exposes plant and user identity. Common patterns shown below;
  // adjust to match reality.
  const plantId = req.user?.plantId || req.session?.user?.plantId || req.session?.plantId || null;
  const externalUserId = req.user?.id || req.session?.user?.email || req.session?.userId || null;

  const apiKey = resolveApiKeyForPlant(plantId);

  if (!apiKey) {
    return res.status(503).json({
      error: plantId
        ? `No NexGen API key configured for plant "${plantId}", and no fallback NEXGEN_API_KEY is set.`
        : 'NEXGEN_API_KEY is not configured on this server, and no plant could be identified for this request.',
    });
  }
  if (!plantId) {
    console.warn('CorverxisONE -> NexGen AI Gateway: no plant identified for this request - using the fallback API key, which means this request will NOT be isolated per-plant on the NexGen side. Update plant resolution above to match this backend\'s real auth/plant model.');
  }
  if (!externalUserId) {
    console.warn('CorverxisONE -> NexGen AI Gateway: no authenticated employee found on req - this request will use shared attribution within its plant. Update externalUserId resolution above to match this backend\'s real auth.');
  }

  try {
    const nexgenResp = await fetch(`${NEXGEN_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'nexgen-ultra-v1',
        messages: [{ role: 'user', content: prompt }],
        system: system || 'You are NexGen Ultra, Corverxis Technologies\' manufacturing AI assistant.',
        max_tokens: max_tokens || 1000,
        domain: domain || 'automation',
        external_user_id: externalUserId,
      }),
    });

    if (!nexgenResp.ok) {
      const errBody = await nexgenResp.json().catch(() => ({}));
      return res.status(nexgenResp.status).json({
        error: errBody.error?.message || `NexGen API returned ${nexgenResp.status}`,
      });
    }

    const data = await nexgenResp.json();
    const text = data.choices?.[0]?.message?.content || 'No response received.';

    res.json({ text, usage: data.usage, latency_ms: data.latency_ms, plant_id: plantId });
  } catch (err) {
    console.error('CorverxisONE -> NexGen AI Gateway error:', err.message);
    res.status(502).json({ error: 'Failed to reach NexGen AI Gateway: ' + err.message });
  }
});

module.exports = router;
