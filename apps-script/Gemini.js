/**
 * Ask Gemini about your spending. The page sends the conversation and a compact summary of this cycle
 * (see src/lib/chatContext.ts); Gemini answers in JSON: a short reply, plus changes it suggests, which the
 * page shows as cards you apply yourself. Nothing here writes to your data.
 *
 * Setup (once, in the Apps Script editor → Project Settings → Script properties):
 *   GEMINI_API_KEY  your key from Google AI Studio
 *   GEMINI_MODEL    optional; defaults to GEMINI_DEFAULT_MODEL
 */

const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

const GEMINI_SYSTEM = [
  'You are the budgeting assistant inside a personal spending tracker used by one person in Indonesia.',
  'Answer from the data below (this pay cycle, amounts in its currency). Be concrete: name merchants, categories and amounts.',
  'Keep replies short: at most about 120 words, short paragraphs or "- " bullets, **bold** for key numbers. Reply in the language the user writes in.',
  'You give budgeting help only: no investment, tax or legal advice.',
  'Big one-off purchases inflate the daily average; say so when the pace projection looks driven by them.',
  'Transfers between own accounts, savings, investments and card bill payments are not spending.',
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
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  let data = null;
  try {
    data = JSON.parse(res.getContentText());
  } catch (e) {
    /* not JSON: reported below */
  }
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
    const out = JSON.parse(text);
    return { reply: String(out.reply || ''), actions: Array.isArray(out.actions) ? out.actions.slice(0, 5) : [] };
  } catch (e) {
    // Not the JSON we asked for: show it as a plain answer.
    return { reply: text, actions: [] };
  }
}
