import { useEffect, useMemo, useRef, useState } from 'react';
import { run } from './gas';
import type { TxView } from './budget';
import { CATEGORIES, OTHER_CATEGORIES } from '../data/categories';
import { merchantKey } from '../data/transactions';
import { tidyName } from './format';

/** Where Gmail import puts what it can't place: the transactions to sort. */
export const UNSORTED = 'Buffer';

export type Confidence = 'high' | 'medium' | 'low';
/** A suggested category for one transaction, and why. */
export type Guess = { category: string; sub?: string; why: string; confidence: Confidence; by: 'pattern' | 'gemini' };
type Saved = { category: string; sub: string; why: string; confidence: Confidence };

export const getGuesses = () => run<Record<string, Saved>>('getGuesses');
export const guessCategories = (payload: { items: unknown[]; examples: unknown[]; categories: { name: string; subs: string[] }[] }) =>
  run<{ guesses?: Record<string, Saved>; error?: string; detail?: string }>('guessCategories', payload);

/** Spending still in Buffer: what the To sort queue goes through. */
export const needsSorting = (t: TxView) => t.cat === UNSORTED && !t.isIncome && !t.isTransfer && !t.isCcPayment && !t.isInstallment;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const rp = (v: number) => 'Rp ' + Math.round(v).toLocaleString('id-ID');

/** What you already sorted, by merchant: the pattern guesses learn from it. */
export function sortedByMerchant(all: TxView[]) {
  const m = new Map<string, TxView[]>();
  for (const t of all) {
    if (t.cat === UNSORTED || t.isCcPayment) continue;
    const k = merchantKey(t.title);
    if (!k) continue;
    const list = m.get(k) ?? [];
    list.push(t);
    m.set(k, list);
  }
  return m;
}

const tally = (list: TxView[]) => {
  const c = new Map<string, { category: string; sub?: string; n: number }>();
  for (const t of list) {
    const k = t.cat + '›' + (t.sub ?? '');
    const e = c.get(k) ?? { category: t.cat, sub: t.sub, n: 0 };
    e.n++;
    c.set(k, e);
  }
  return [...c.values()].sort((a, b) => b.n - a.n);
};

/**
 * A guess from your own history, no Gemini needed: the merchant almost always goes to one category, or (for a
 * merchant split across categories, like a ride app that also delivers food) transactions of a similar amount do.
 */
export function patternGuess(t: TxView, byMerchant: Map<string, TxView[]>): Guess | null {
  const same = byMerchant.get(merchantKey(t.title))?.filter(x => x.id !== t.id) ?? [];
  if (same.length < 2) return null;
  const name = tidyName(t.title);
  const top = tally(same)[0];
  if (top.n / same.length >= 0.75)
    return { category: top.category, sub: top.sub, by: 'pattern', confidence: top.n >= 3 ? 'high' : 'medium', why: `Your last ${same.length} ${name} were ${top.category}${top.sub ? ' › ' + top.sub : ''}.` };
  // Split merchant: look at the five closest in amount.
  const near = [...same].sort((a, b) => Math.abs(a.amount - t.amount) - Math.abs(b.amount - t.amount)).slice(0, 5);
  const best = tally(near)[0];
  if (near.length >= 3 && best.n / near.length >= 0.6) {
    const amts = near.filter(x => x.cat === best.category).map(x => x.amount);
    return {
      category: best.category,
      sub: best.sub,
      by: 'pattern',
      confidence: 'medium',
      why: `Your ${name} around ${rp(Math.min(...amts))}${Math.max(...amts) > Math.min(...amts) ? '–' + rp(Math.max(...amts)).slice(3) : ''} are usually ${best.category}.`,
    };
  }
  return null;
}

/** Up to four categories to offer first: the guess, then this merchant's usual ones, then your most used. */
export function suggestionsFor(t: TxView, guess: Guess | null, byMerchant: Map<string, TxView[]>, popular: string[]) {
  const out: { category: string; sub?: string }[] = [];
  const add = (category: string, sub?: string) => {
    if (category === UNSORTED || out.some(x => x.category === category && (x.sub ?? '') === (sub ?? ''))) return;
    if (out.length < 4) out.push({ category, sub });
  };
  if (guess) add(guess.category, guess.sub);
  for (const e of tally(byMerchant.get(merchantKey(t.title))?.filter(x => x.id !== t.id) ?? [])) add(e.category, e.sub);
  for (const c of popular) add(c);
  return out;
}

/** Your most used spending categories lately, for when a merchant is new. */
export function popularCategories(all: TxView[]) {
  const n = new Map<string, number>();
  for (const t of all.slice(0, 400)) if (t.cat !== UNSORTED && !t.isTransfer && !t.isIncome) n.set(t.cat, (n.get(t.cat) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

const asRow = (t: TxView) => ({ merchant: t.title, amount: Math.round(t.amount), time: t.time, weekday: WEEKDAY[t.date.getDay()], account: t.account });

/**
 * Guesses for every transaction to sort: your own pattern when it's clear, else Gemini's (saved in the Sheet, so
 * each transaction is asked about once). Gemini is asked in the background, at most once per visit.
 */
export function useGuesses(all: TxView[], subcategories: Record<string, string[]>) {
  const [saved, setSaved] = useState<Record<string, Saved> | null>(null);
  const [status, setStatus] = useState<'' | 'asking' | 'no_key' | 'error'>('');
  const asked = useRef(false);
  const byMerchant = useMemo(() => sortedByMerchant(all), [all]);
  const popular = useMemo(() => popularCategories(all), [all]);
  const toSort = useMemo(() => all.filter(needsSorting), [all]);

  useEffect(() => {
    getGuesses()
      .then(setSaved)
      .catch(() => setSaved({}));
  }, []);

  const guesses = useMemo(() => {
    const out: Record<string, Guess> = {};
    for (const t of toSort) {
      const p = patternGuess(t, byMerchant);
      const g = saved?.[t.id];
      // A clear pattern of yours beats Gemini, and any pattern beats a guess Gemini isn't sure of.
      if (p && (p.confidence === 'high' || g?.confidence === 'low')) out[t.id] = p;
      else if (g) out[t.id] = { category: g.category, sub: g.sub || undefined, why: g.why, confidence: g.confidence, by: 'gemini' };
      else if (p) out[t.id] = p;
    }
    return out;
  }, [toSort, byMerchant, saved]);

  useEffect(() => {
    if (!saved || asked.current) return;
    const missing = toSort.filter(t => !guesses[t.id] || guesses[t.id].confidence !== 'high').filter(t => !saved[t.id]);
    if (!missing.length) return;
    asked.current = true;
    const known = new Set([...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES]);
    const examples = all
      .filter(t => t.cat !== UNSORTED && !t.isCcPayment && known.has(t.cat))
      .slice(0, 300)
      .map(t => ({ ...asRow(t), category: t.cat, sub: t.sub ?? null }));
    const categories = [...CATEGORIES.filter(c => c.name !== UNSORTED).map(c => ({ name: c.name, subs: subcategories[c.name] ?? [] })), ...OTHER_CATEGORIES.map(n => ({ name: n, subs: [] }))];
    setStatus('asking');
    guessCategories({ items: missing.slice(0, 40).map(t => ({ id: t.id, ...asRow(t) })), examples, categories })
      .then(r => {
        if (r.error) return setStatus(r.error === 'no_key' ? 'no_key' : 'error');
        setSaved(s => ({ ...(s ?? {}), ...(r.guesses ?? {}) }));
        setStatus('');
      })
      .catch(() => setStatus('error'));
  }, [saved, toSort, guesses, all, subcategories]);

  const suggest = (t: TxView) => suggestionsFor(t, guesses[t.id] ?? patternGuess(t, byMerchant), byMerchant, popular);
  return { toSort, guesses, status, suggest };
}

export type Guesses = ReturnType<typeof useGuesses>;
