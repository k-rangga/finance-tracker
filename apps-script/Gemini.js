/**
 * Ask Gemini about your spending. The page sends the conversation and a compact summary of this cycle
 * (see src/lib/chatContext.ts); Gemini answers in JSON: a short reply, plus changes it suggests, which the
 * page shows as cards you apply yourself. Nothing here writes to your data.
 *
 * Setup (once, in the Apps Script editor → Project Settings → Script properties):
 *   GEMINI_API_KEY  your key from Google AI Studio
 *   GEMINI_MODEL    optional; defaults to GEMINI_DEFAULT_MODEL
 *   GEMINI_PLAN_MODEL optional; the model for planning on the Plan tab, defaults to GEMINI_PLAN_MODEL
 */

// Strictly Free Tier models, ordered for speed and generous free quota:
// - Quick chat & classification: gemini-3.5-flash-lite with 'minimal' thinking (fastest, ~1-3s).
// - Deep chat & planning: gemini-3.6-flash with 'low' thinking (smarter reasoning, free tier, fast).
// - Last-resort fallback: gemini-3.8-flash (free tier, lower daily cap).
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_PLAN_MODEL = 'gemini-3.6-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-3.8-flash';

const GEMINI_SYSTEM = [
  'You are Maxie, the budgeting assistant inside a personal spending tracker used by one person in Indonesia.',
  'Voice: a cheerful, warm, capable friend who is great with money. Speak as "I" and call the person "you" (use their name from context when greeting). Lead with the answer, then the reason. Short sentences, contractions, plain everyday words.',
  'Celebrate wins genuinely and keep tough stretches upbeat and constructive — never scold. Skip robotic filler ("Great question!", "Certainly!"), no emoji, no dog puns; light exclamation marks are fine when cheering a win.',
  'In Indonesian use "kamu" for the person and "aku" for yourself — friendly, cheerful, and natural, not stiff or formal.',
  'Answer from the data below (this pay cycle, amounts in its currency). Be concrete: name merchants, categories and amounts. Use pre-computed "topMerchants", "saved", "cards", and "categories" totals directly instead of recounting rows by hand.',
  'Keep replies short: at most about 110 words, short paragraphs or "- " / "1. " lists, **bold** for key numbers. Reply in the language of the user\'s latest message; when that is unclear, in the context\'s "language".',
  'You give budgeting help only: no investment, tax or legal advice.',
  'Big one-off purchases inflate the daily average; say so when the pace projection looks driven by them.',
  'Transfers between own accounts, savings, investments and card bill payments are not spending.',
  '"answerFeedback" (when present) holds past answers the user rated: write more like the "liked" ones, and avoid whatever made the "disliked" ones unhelpful (length, tone, vagueness, wrong focus).',
  '',
  'Respond with JSON only: {"reply": string, "actions": Action[], "followUps": string[]}.',
  '"followUps": 2-3 very short (under 45 chars) helpful next questions the user might tap next, in the same language as your reply.',
  'Suggest actions only when they clearly help; usually 0-3.',
  'Action is one of:',
  '- {"type":"rule","merchant":string,"category":string,"sub":string|null,"why":string}  every transaction from this merchant goes to category (and sub-category).',
  '- {"type":"recategorize","txIds":string[],"category":string,"sub":string|null,"why":string}  move these transactions.',
  '- {"type":"move_limit","from":string,"to":string,"amount":number,"why":string}  move this much of one variable category\'s monthly limit to another variable category (the total budget stays the same).',
  'Use only category names from "categoryNames", sub-categories from that category\'s "subs", and transaction ids from "transactions". "why" is one short sentence.',
].join('\n');

/** Deduplicate a list of model names while keeping order. */
function uniqueModels_(list) {
  const out = [];
  list.forEach(m => {
    const v = String(m || '').trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

/** Pick the fastest supported thinkingLevel for a model in quick vs deep mode. */
function thinkingLevelFor_(model, mode) {
  const supportsMinimal = /3\.5-flash-lite|3\.6-flash|3\.1-flash-lite|3-flash/.test(model);
  if (mode === 'quick') return supportsMinimal ? 'minimal' : 'low';
  return 'low';
}

/** p: { messages: [{ role: 'user'|'model', text }], context: object, deep?: boolean } → { reply, actions, followUps, model } or { error, detail }. */
function askGemini_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { error: 'no_key' };
  const primary = props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  let model = primary;
  // The last 8 turns are plenty for a budgeting chat and keep each request small and fast.
  const messages = (p.messages || []).slice(-8);
  const body = {
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM + '\n\nData (JSON):\n' + JSON.stringify(p.context || {}) }] },
    contents: messages.map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text || '').slice(0, 1500) }] })),
    // Minimal thinking on Flash-Lite = near-instant replies (~1-3s) strictly on the Free Tier.
    generationConfig: { responseMimeType: 'application/json', temperature: 0.35, maxOutputTokens: 700, thinkingConfig: { thinkingLevel: thinkingLevelFor_(primary, 'quick') } },
  };
  const started = Date.now();
  let res, data;
  if (p.deep) {
    // Deep chat & planning: Gemini 3.6 Flash (free tier, low thinking) with built-in local price knowledge.
    body.generationConfig.maxOutputTokens = 1600;
    if (p.context && p.context.city)
      body.systemInstruction.parts[0].text +=
        '\n\nThe person lives in ' + p.context.city + '. Compare their biggest everyday categories against typical local prices in ' + p.context.city + ' where it helps.';
    const useSearch = props.getProperty('GEMINI_SEARCH') === 'true' && !!(p.context && p.context.city);
    const g = geminiPlan_(key, body, useSearch);
    res = g.res;
    data = g.data;
    model = g.model;
  } else {
    // Quick chat: fast free-tier Flash-Lite, stepping to 3.6 Flash if rate-limited, timed out, or unavailable.
    const chain = uniqueModels_([primary, GEMINI_PLAN_MODEL, GEMINI_DEFAULT_MODEL]);
    const stepDown = code => code === 429 || code === 403 || code === 404 || code >= 500;
    for (let i = 0; i < chain.length; i++) {
      model = chain[i];
      const b = JSON.parse(JSON.stringify(body));
      b.generationConfig.thinkingConfig = { thinkingLevel: thinkingLevelFor_(model, 'quick') };
      res = geminiFetch_(model, key, b);
      data = geminiJson_(res);
      if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
        delete b.generationConfig.thinkingConfig;
        res = geminiFetch_(model, key, b);
        data = geminiJson_(res);
      }
      if (res.getResponseCode() === 200 || !stepDown(res.getResponseCode())) break;
    }
  }
  // Timing and token use land in the Apps Script Executions log, to see what makes a reply slow.
  console.log('askGemini ' + model + ' ' + res.getResponseCode() + ' in ' + (Date.now() - started) + 'ms · ' + JSON.stringify((data && data.usageMetadata) || {}));
  if (res.getResponseCode() !== 200) {
    const msg = data && data.error && data.error.message ? data.error.message : 'HTTP ' + res.getResponseCode();
    return { error: res.getResponseCode() === 429 ? 'quota' : 'api', detail: String(msg).slice(0, 300) };
  }
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(x => x.text || '').join('') : '';
  if (!text) {
    const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'empty';
    return { error: 'blocked', detail: String(why) };
  }
  try {
    // Some models wrap JSON in a code fence (or, with search on, in a sentence) even when asked not to.
    const out = JSON.parse(jsonPart_(text));
    const followUps = Array.isArray(out.followUps)
      ? out.followUps.map(x => String(x || '').trim()).filter(x => x && x.length <= 70).slice(0, 3)
      : [];
    return { reply: String(out.reply || ''), actions: Array.isArray(out.actions) ? out.actions.slice(0, 5) : [], followUps: followUps, model: model };
  } catch (e) {
    // Not the JSON we asked for: show it as a plain answer.
    return { reply: text, actions: [], followUps: [], model: model };
  }
}

/** The JSON object inside a reply: without a code fence, or cut out of a sentence around it. */
function jsonPart_(text) {
  const t = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

function geminiFetch_(model, key, body) {
  return UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
}

function geminiJson_(res) {
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    return null;
  }
}

/**
 * A deep / planning request (strictly Free Tier): tries GEMINI_PLAN_MODEL (default gemini-3.6-flash, low thinking),
 * then steps down cleanly to gemini-3.5-flash-lite and gemini-3.8-flash on 429/403/404/5xx/timeout.
 * Google Search grounding is off on Free Tier (only enabled if GEMINI_SEARCH='true').
 */
function geminiPlan_(key, body, search) {
  const props = PropertiesService.getScriptProperties();
  const models = uniqueModels_([
    props.getProperty('GEMINI_PLAN_MODEL') || GEMINI_PLAN_MODEL,
    props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL,
    GEMINI_FALLBACK_MODEL,
  ]);
  const b = JSON.parse(JSON.stringify(body));
  // Search grounding and JSON mode don't mix: with search, the JSON comes back as text (parsed the same way).
  const withSearch = () => {
    b.tools = [{ google_search: {} }];
    delete b.generationConfig.responseMimeType;
  };
  const withoutSearch = () => {
    delete b.tools;
    b.generationConfig.responseMimeType = 'application/json';
  };
  if (search) withSearch();
  const errText = d => JSON.stringify((d && d.error) || '');
  // Worth stepping down from: over quota or rate-limited (429), not allowed (403), not found (404), busy/timeout (5xx).
  const stepDown = code => code === 429 || code === 403 || code === 404 || code >= 500;
  let res, data, model;
  for (let i = 0; i < models.length; i++) {
    model = models[i];
    b.generationConfig.thinkingConfig = { thinkingLevel: thinkingLevelFor_(model, 'deep') };
    const started = Date.now();
    res = geminiFetch_(model, key, b);
    data = geminiJson_(res);
    // Search isn't supported on Free Tier, or its quota is used up: retry without it.
    if (b.tools && (stepDown(res.getResponseCode()) || (res.getResponseCode() === 400 && /search|tool|grounding|mime/i.test(errText(data))))) {
      console.log('plan ' + model + ' +search ' + res.getResponseCode() + ': ' + errText(data).slice(0, 200));
      withoutSearch();
      res = geminiFetch_(model, key, b);
      data = geminiJson_(res);
    }
    if (res.getResponseCode() === 400 && /thinking/i.test(errText(data))) {
      delete b.generationConfig.thinkingConfig;
      res = geminiFetch_(model, key, b);
      data = geminiJson_(res);
    }
    const code = res.getResponseCode();
    console.log('plan ' + model + (b.tools ? ' +search ' : ' ') + code + ' in ' + (Date.now() - started) + 'ms' + (code === 200 ? '' : ': ' + errText(data).slice(0, 200)));
    if (code === 200 || !(stepDown(code) || /model/i.test(errText(data)))) break;
  }
  return { res: res, data: data, model: model, searched: !!b.tools };
}

/**
 * A first draft of your monthly trading note, from the month's numbers and your own lessons (p.summary: text).
 * Returns { text } or { error }. Like the chat, it only suggests; you edit and keep what you want.
 */
function draftJournalMonth_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { error: 'no_key' };
  const model = props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  const body = {
    systemInstruction: {
      parts: [
        {
          text: [
            "You help a trader write their monthly trading journal note, in their voice (first person), from their month's numbers and their own lessons.",
            'Write 3 short parts with these headings: "What worked", "What to change", "One rule for next month". At most 120 words in all, plain "- " bullets.',
            'Be concrete: name the setups, mistakes and tickers in the data. No investment advice, no price predictions. Reply in the language the lessons are written in (English if none).',
          ].join('\n'),
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: String(p.summary || '').slice(0, 12000) }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 600, thinkingConfig: { thinkingLevel: thinkingLevelFor_(model, 'quick') } },
  };
  let res = geminiFetch_(model, key, body);
  let data = geminiJson_(res);
  if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
    delete body.generationConfig.thinkingConfig;
    res = geminiFetch_(model, key, body);
    data = geminiJson_(res);
  }
  if (res.getResponseCode() === 429) return { error: 'quota', detail: String((data && data.error && data.error.message) || '').slice(0, 300) };
  if (res.getResponseCode() !== 200) return { error: 'api', detail: String((data && data.error && data.error.message) || 'HTTP ' + res.getResponseCode()).slice(0, 300) };
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(x => x.text || '').join('').trim() : '';
  return text ? { text: text } : { error: 'blocked' };
}

/**
 * Maxie's check of a planned pay cycle. p: { income, bufferGoal, left, promised: {...}, categories: [{ name, type,
 * next, usual, thisCycle, lastCycle }], oneOffs: [...] } (amounts in the app's currency). Returns
 * { verdict, changes: [{ category, amount, why }] } or { error }. Changes only suggest; the page applies them.
 */
function checkCyclePlan_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { error: 'no_key' };
  const cats = (p.categories || []).map(c => String(c.name));
  const useSearch = props.getProperty('GEMINI_SEARCH') === 'true' && !!p.city;
  const body = {
    systemInstruction: {
      parts: [
        {
          text: (p.mode === 'build'
            ? [
                'You are Maxie, building one person\'s budget plan for their next pay cycle (Indonesia, amounts in their currency).',
                'Set an amount for each everyday (variable) category from what they actually spent this cycle (thisCycle, projected to the end) and last cycle (lastCycle):',
                'realistic, a little under their real spending where they can afford it, and round (to 50,000 in rupiah). Leave fixed bills and installments as they are unless one is clearly wrong.',
                'Goal: what is left unplanned after everything should be at least bufferGoal.',
                'verdict: two short sentences in your voice, warm and plain, speaking as "I" to "you": what you planned and the one thing to watch. At most 40 words.',
                'changes: one per category you set, { "category": name from categories, "amount": the amount for next cycle, "why": at most 12 words, e.g. "You averaged Rp1.1M, so this leaves a little room" }.',
              ]
            : [
                'You are Maxie, checking one person\'s budget plan for their next pay cycle (Indonesia, amounts in their currency).',
                'Goal: what is left unplanned after everything should be at least bufferGoal, and each category should be realistic',
                'given what was actually spent this cycle (thisCycle, projected to the end) and last cycle (lastCycle).',
                'Fixed bills and installments are commitments: change everyday (variable) categories first.',
                'verdict: one short sentence in your voice, speaking as "I" to "you", at most 20 words, the most important point first.',
                'changes: at most 3, each { "category": name from categories, "amount": the new amount for next cycle (a round number), "why": at most 12 words }.',
                'If the plan already meets the buffer and looks realistic, return no changes.',
              ]
          )
            .concat([
              'Check the whole plan, not just everyday categories: fixed bills, installments, subscriptions, one-off costs, the savings target and the buffer.',
              'Each category has "spending": what really happens this cycle (perDay, purchases, averagePurchase, biggestPurchase, topMerchants, subCategories). Use it: one big purchase is not a habit; many small ones are.',
              p.city
                ? 'They live in ' + p.city + '. Compare their everyday averagePurchase against typical local prices in ' + p.city + ' (meal out, coffee, groceries for one, rides) and mention it in "why" or "notes" where it matters.'
                : 'No city is set, so do not guess local prices.',
              'notes: up to 4 short findings about the rest of the plan (fixed bills, installments, one-offs, savings, buffer), each at most 20 words, in your voice. Empty when there is nothing worth saying.',
              'Voice: cheerful, warm and clear, no emoji, no filler.',
              p.language === 'Bahasa Indonesia'
                ? 'Write verdict, why and notes in Bahasa Indonesia: natural and friendly, "kamu" for the person and "aku" for yourself, not formal.'
                : 'Write verdict, why and notes in English.',
              'Respond with JSON only: {"verdict": string, "changes": [{"category": string, "amount": number, "why": string}], "notes": string[]}',
            ])
            .join('\n'),
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(p) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: p.mode === 'build' ? 2200 : 1400, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const g = geminiPlan_(key, body, useSearch);
  const res = g.res;
  const data = g.data;
  if (res.getResponseCode() === 429) return { error: 'quota', detail: String((data && data.error && data.error.message) || '').slice(0, 300) };
  if (res.getResponseCode() !== 200) return { error: 'api', detail: String((data && data.error && data.error.message) || 'HTTP ' + res.getResponseCode()).slice(0, 300) };
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(x => x.text || '').join('') : '';
  try {
    const out = JSON.parse(jsonPart_(text));
    const changes = (Array.isArray(out.changes) ? out.changes : [])
      .map(c => ({ category: cats.filter(n => n.toLowerCase() === String(c.category || '').trim().toLowerCase())[0], amount: Math.max(0, Math.round(Number(c.amount))), why: String(c.why || '').slice(0, 120) }))
      .filter(c => c.category && isFinite(c.amount))
      .slice(0, p.mode === 'build' ? 20 : 3);
    const notes = (Array.isArray(out.notes) ? out.notes : []).map(n => String(n).slice(0, 200)).filter(Boolean).slice(0, 4);
    return { verdict: String(out.verdict || '').slice(0, 400), changes: changes, notes: notes, model: g.model, searched: g.searched };
  } catch (e) {
    return { error: 'blocked' };
  }
}

/** Saved guesses, { txId: { category, sub, why, confidence } }. */
function categoryGuesses_() {
  const out = {};
  readTable_('cat_guesses').forEach(r => {
    if (r.tx_id && r.category) out[r.tx_id] = { category: r.category, sub: r.sub || '', why: r.why || '', confidence: r.confidence || 'medium' };
  });
  return out;
}

/**
 * Guess a category for each transaction still to sort, from how you sorted the rest.
 * p: { items: [{ id, merchant, amount, time, weekday, account }], examples: [{ merchant, amount, time, weekday, account, category, sub }],
 *      categories: [{ name, subs }] }. Saves each guess in cat_guesses and returns { guesses: { txId: guess } } or { error }.
 */
function guessCategories_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { error: 'no_key' };
  const model = props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  const items = (p.items || []).slice(0, 40);
  if (!items.length) return { guesses: {} };
  const categories = p.categories || [];
  const names = categories.map(c => String(c.name));
  const body = {
    systemInstruction: {
      parts: [
        {
          text: [
            'You sort the spending of one person in Indonesia into their own budget categories.',
            '"examples" are transactions they already sorted: learn their patterns from merchant names, amounts, time of day, weekday and account',
            '(e.g. the same ride app can be a ride for small morning amounts and food at lunch for bigger ones).',
            'For each item in "items", pick the most likely category from "categories" (and a sub-category from its "subs", or null).',
            'Use general knowledge of Indonesian merchants when the examples say nothing about one.',
            'confidence: "high" when the examples show a clear pattern for this merchant, "medium" for a reasonable guess, "low" when unsure.',
            'why: one short sentence a person would understand, naming the pattern (e.g. "Your Grab orders over Rp 30k around lunch are Take out").',
            'Respond with JSON only: {"guesses":[{"id":string,"category":string,"sub":string|null,"confidence":"high"|"medium"|"low","why":string}]}',
          ].join('\n'),
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ categories: categories, examples: (p.examples || []).slice(0, 300), items: items }) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
  let res = geminiFetch_(model, key, body);
  let data = geminiJson_(res);
  if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
    delete body.generationConfig.thinkingConfig;
    res = geminiFetch_(model, key, body);
    data = geminiJson_(res);
  }
  if (res.getResponseCode() === 429) return { error: 'quota', detail: String((data && data.error && data.error.message) || '').slice(0, 300) };
  if (res.getResponseCode() !== 200) return { error: 'api', detail: String((data && data.error && data.error.message) || 'HTTP ' + res.getResponseCode()).slice(0, 300) };
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(x => x.text || '').join('') : '';
  let list = [];
  try {
    list = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')).guesses || [];
  } catch (e) {
    return { error: 'blocked' };
  }
  const asked = {};
  items.forEach(i => (asked[String(i.id)] = true));
  const now = new Date().toISOString();
  const out = {};
  list.forEach(g => {
    const id = String(g.id || '');
    const cat = names.filter(n => n.toLowerCase() === String(g.category || '').trim().toLowerCase())[0];
    if (!asked[id] || !cat) return;
    const subs = (categories.filter(c => c.name === cat)[0] || {}).subs || [];
    const sub = subs.filter(x => x.toLowerCase() === String(g.sub || '').trim().toLowerCase())[0] || '';
    const confidence = /^(high|medium|low)$/.test(g.confidence) ? g.confidence : 'medium';
    out[id] = { category: cat, sub: sub, why: String(g.why || '').slice(0, 200), confidence: confidence };
    upsertRow_('cat_guesses', 'tx_id', { tx_id: id, category: cat, sub: sub, why: out[id].why, confidence: confidence, updated_at: now });
  });
  console.log('guessCategories ' + model + ': ' + Object.keys(out).length + ' of ' + items.length);
  return { guesses: out };
}
