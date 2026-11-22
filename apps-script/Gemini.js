/**
 * Ask Gemini about your spending. The page sends the conversation and a compact summary of this cycle
 * (see src/lib/chatContext.ts); Gemini answers in JSON: a short reply, plus changes it suggests, which the
 * page shows as cards you apply yourself. Nothing here writes to your data.
 *
 * Setup (once, in the Apps Script editor → Project Settings → Script properties):
 *   GEMINI_API_KEY  your key from Google AI Studio
 *   GEMINI_MODEL    optional; defaults to GEMINI_DEFAULT_MODEL
 */

// Flash-Lite: a budgeting answer in seconds. Set GEMINI_MODEL to 'gemini-3.8-flash' for deeper (slower) answers.
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const GEMINI_SYSTEM = [
  'You are Maxie, the budgeting assistant inside a personal spending tracker used by one person in Indonesia.',
  'Voice: a calm, warm, capable friend who is very good with money. Speak as "I" and call the person "you". Lead with the answer, then the reason. Short sentences, contractions, plain everyday words.',
  'No filler openers ("Great question!", "Certainly!"), no hype or flattery, no exclamation marks, no emoji, no dog puns. Be kind about overspending: say what happened and the next step, never scold.',
  'In Indonesian use "kamu" for the person and "aku" for yourself, friendly and natural, not formal.',
  'Answer from the data below (this pay cycle, amounts in its currency). Be concrete: name merchants, categories and amounts.',
  'Keep replies short: at most about 120 words, short paragraphs or "- " bullets, **bold** for key numbers. Reply in the language the user writes in.',
  'You give budgeting help only: no investment, tax or legal advice.',
  'Big one-off purchases inflate the daily average; say so when the pace projection looks driven by them.',
  'Transfers between own accounts, savings, investments and card bill payments are not spending.',
  '"answerFeedback" (when present) holds past answers the user rated: write more like the "liked" ones, and avoid whatever made the "disliked" ones unhelpful (length, tone, vagueness, wrong focus).',
  '',
  'Respond with JSON only: {"reply": string, "actions": Action[]}. Suggest actions only when they clearly help; usually 0-3.',
  'Action is one of:',
  '- {"type":"rule","merchant":string,"category":string,"sub":string|null,"why":string}  every transaction from this merchant goes to category (and sub-category).',
  '- {"type":"recategorize","txIds":string[],"category":string,"sub":string|null,"why":string}  move these transactions.',
  '- {"type":"move_limit","from":string,"to":string,"amount":number,"why":string}  move this much of one variable category\'s monthly limit to another (the total budget stays the same).',
  'Use only category names from "categoryNames", sub-categories from that category\'s "subs", and transaction ids from "transactions". "why" is one short sentence.',
].join('\n');

/** p: { messages: [{ role: 'user'|'model', text }], context: object } → { reply, actions } or { error, detail }. */
function askGemini_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { error: 'no_key' };
  const model = props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  // The last 12 turns are plenty for a budgeting chat and keep each request small.
  const messages = (p.messages || []).slice(-12);
  const body = {
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM + '\n\nData (JSON):\n' + JSON.stringify(p.context || {}) }] },
    contents: messages.map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text || '').slice(0, 2000) }] })),
    // Low thinking: a budgeting answer doesn't need long reasoning, and it's what makes replies slow.
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const started = Date.now();
  let res = geminiFetch_(model, key, body);
  let data = geminiJson_(res);
  // A model that doesn't take a thinking level: ask again without it.
  if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
    delete body.generationConfig.thinkingConfig;
    res = geminiFetch_(model, key, body);
    data = geminiJson_(res);
  }
  // Timing and token use land in the Apps Script Executions log, to see what makes a reply slow.
  console.log('askGemini ' + model + ' ' + res.getResponseCode() + ' in ' + (Date.now() - started) + 'ms · ' + JSON.stringify((data && data.usageMetadata) || {}));
  if (res.getResponseCode() !== 200) {
    const msg = data && data.error && data.error.message ? data.error.message : 'HTTP ' + res.getResponseCode();
    return { error: 'api', detail: String(msg).slice(0, 300) };
  }
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(x => x.text || '').join('') : '';
  if (!text) {
    const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'empty';
    return { error: 'blocked', detail: String(why) };
  }
  try {
    // Some models wrap JSON in a code fence even when asked not to.
    const out = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
    return { reply: String(out.reply || ''), actions: Array.isArray(out.actions) ? out.actions.slice(0, 5) : [], model: model };
  } catch (e) {
    // Not the JSON we asked for: show it as a plain answer.
    return { reply: text, actions: [], model: model };
  }
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
    generationConfig: { temperature: 0.5, maxOutputTokens: 600, thinkingConfig: { thinkingLevel: 'low' } },
  };
  let res = geminiFetch_(model, key, body);
  let data = geminiJson_(res);
  if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
    delete body.generationConfig.thinkingConfig;
    res = geminiFetch_(model, key, body);
    data = geminiJson_(res);
  }
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
  const model = props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  const cats = (p.categories || []).map(c => String(c.name));
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
              'Voice: calm and friendly, no exclamation marks, no emoji, no filler. Reply in English.',
              'Respond with JSON only: {"verdict": string, "changes": [{"category": string, "amount": number, "why": string}]}',
            ])
            .join('\n'),
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(p) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: p.mode === 'build' ? 1600 : 800, thinkingConfig: { thinkingLevel: 'low' } },
  };
  let res = geminiFetch_(model, key, body);
  let data = geminiJson_(res);
  if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
    delete body.generationConfig.thinkingConfig;
    res = geminiFetch_(model, key, body);
    data = geminiJson_(res);
  }
  if (res.getResponseCode() !== 200) return { error: 'api', detail: String((data && data.error && data.error.message) || 'HTTP ' + res.getResponseCode()).slice(0, 300) };
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(x => x.text || '').join('') : '';
  try {
    const out = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
    const changes = (Array.isArray(out.changes) ? out.changes : [])
      .map(c => ({ category: cats.filter(n => n.toLowerCase() === String(c.category || '').trim().toLowerCase())[0], amount: Math.max(0, Math.round(Number(c.amount))), why: String(c.why || '').slice(0, 120) }))
      .filter(c => c.category && isFinite(c.amount))
      .slice(0, p.mode === 'build' ? 20 : 3);
    return { verdict: String(out.verdict || '').slice(0, 300), changes: changes };
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
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: 'low' } },
  };
  let res = geminiFetch_(model, key, body);
  let data = geminiJson_(res);
  if (res.getResponseCode() === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
    delete body.generationConfig.thinkingConfig;
    res = geminiFetch_(model, key, body);
    data = geminiJson_(res);
  }
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
