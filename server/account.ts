/**
 * Account lifecycle helpers: soft-deactivating a user sets them to `inactive` across Supabase Auth + DB
 * while archiving anonymized learnings (merchant category rules, rated Maxie answer feedback, and trigger
 * aggregates — zero PII, zero email bodies, zero bank names, zero raw transactions).
 */
import crypto from 'node:crypto';
import { admin, serviceKey, supabaseUrl } from './env.js';
import { disconnect } from './google.js';

export type ArchivedLearnings = {
  archivedAt: string;
  merchantRules: Record<string, string>;
  merchantSubRules: Record<string, string>;
  notSubscriptions: string[];
  notInstallments: string[];
  notFixedBills: string[];
  chatFeedback: Array<{ q: string; a: string; good: boolean; at: string }>;
  joyTriggerCounts: Record<string, number>;
  preferredLanguage: 'en' | 'id';
};

/**
 * Extract only anonymized, non-PII product learnings from a user's stored settings & category rules.
 * Strips email, name, bank names, income, transactions, notes, and wishlist item names.
 */
export function buildArchivedLearnings({
  settings,
  rules,
  ruleSubs,
  now = new Date(),
}: {
  settings: Record<string, unknown>;
  rules: Array<{ merchant?: string; category?: string; sub?: string | null }>;
  ruleSubs?: Record<string, string>;
  now?: Date;
}): ArchivedLearnings {
  const merchantRules: Record<string, string> = {};
  const merchantSubRules: Record<string, string> = {};
  for (const r of rules) {
    const m = String(r.merchant || '').trim().toLowerCase();
    const cat = String(r.category || '').trim();
    if (!m || !cat) continue;
    merchantRules[m] = cat;
    const sub = String(r.sub ?? ruleSubs?.[r.merchant ?? ''] ?? '').trim();
    if (sub) merchantSubRules[m] = sub;
  }

  const strList = (v: unknown) =>
    Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean).slice(0, 100) : [];

  const chatFeedback = Array.isArray(settings.chatFeedback)
    ? settings.chatFeedback
        .slice(-30)
        .map((f: Record<string, unknown>) => ({
          q: String(f?.q || '').slice(0, 160),
          a: String(f?.a || '').slice(0, 320),
          good: Boolean(f?.good),
          at: String(f?.at || now.toISOString()),
        }))
        .filter(f => f.q || f.a)
    : [];

  const joyTriggerCounts: Record<string, number> = {};
  if (settings.joyChecks && typeof settings.joyChecks === 'object') {
    for (const entry of Object.values(settings.joyChecks as Record<string, Record<string, unknown>>)) {
      const vote = String(entry?.vote || '');
      const trig = String(entry?.trigger || '').trim();
      if (vote === 'skip' && trig) {
        joyTriggerCounts[trig] = (joyTriggerCounts[trig] || 0) + 1;
      }
    }
  }

  return {
    archivedAt: now.toISOString(),
    merchantRules,
    merchantSubRules,
    notSubscriptions: strList(settings.notSubscriptions),
    notInstallments: strList(settings.notInstallments),
    notFixedBills: strList(settings.notFixedBills),
    chatFeedback,
    joyTriggerCounts,
    preferredLanguage: settings.maxieLanguage === 'id' ? 'id' : 'en',
  };
}

/** True when a Supabase Auth user object has been marked inactive or banned. */
export function isInactiveAuthUser(u: { app_metadata?: Record<string, unknown>; banned_until?: string | null }): boolean {
  if (u.app_metadata?.status === 'inactive') return true;
  if (u.banned_until) {
    const t = Date.parse(u.banned_until);
    if (Number.isFinite(t) && t > Date.now()) return true;
  }
  return false;
}

/** Deterministic non-routable placeholder email assigned when releasing a deactivated account's email. */
export function archivedEmailFor(userId: string, now = new Date()): string {
  const id8 = userId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'user';
  return `inactive+${id8}+${now.getTime()}@deleted.maxie.local`;
}

/** Short non-reversible digest for auditing which prior email belonged to an archived row without keeping PII. */
export function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * Free an email address currently held by any `inactive` / banned Supabase Auth user so the same
 * person can register a brand-new `user_id` with that email. Active accounts are never touched.
 * Old deactivated `user_id`s, `props`, `category_rules`, `user_profiles`, and learnings stay intact.
 */
export async function releaseInactiveEmail(rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return false;

  const key = serviceKey();
  const base = supabaseUrl();
  let released = false;

  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=50&filter=${encodeURIComponent(email)}`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (!res.ok) break;

    const body = (await res.json()) as {
      users?: Array<{ id: string; email?: string | null; app_metadata?: Record<string, unknown>; banned_until?: string | null }>;
    };
    const users = body.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      if ((u.email ?? '').trim().toLowerCase() !== email) continue;
      if (!isInactiveAuthUser(u)) continue;

      const now = new Date();
      const put = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(u.id)}`, {
        method: 'PUT',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: archivedEmailFor(u.id, now),
          email_confirm: true,
          app_metadata: {
            ...(u.app_metadata ?? {}),
            status: 'inactive',
            prior_email_hash: hashEmail(email),
            email_released_at: now.toISOString(),
          },
        }),
      });
      if (put.ok) released = true;
    }

    if (users.length < 50) break;
  }

  return released;
}

/**
 * Soft-delete an account:
 * 1. Revoke Google OAuth access & delete tokens.
 * 2. Archive anonymized learnings (`merchantRules`, `chatFeedback`, trigger stats).
 * 3. Persist `account_status = inactive` + `archived_learnings` in `props` (and `public.user_profiles` if present).
 * 4. Mark Supabase Auth user inactive (`ban_duration: '876000h'` + `app_metadata.status = 'inactive'`) instead of hard-deleting.
 */
export async function deactivateUser(userId: string, reason?: string): Promise<{ status: 'inactive'; archivedAt: string }> {
  const now = new Date();
  const archivedAt = now.toISOString();

  await disconnect(userId);

  const [propsRows, ruleRows] = await Promise.all([
    admin(`props?user_id=eq.${encodeURIComponent(userId)}&key=in.(settings)&select=key,value`) as Promise<
      Array<{ key: string; value: string | null }>
    >,
    admin(`category_rules?user_id=eq.${encodeURIComponent(userId)}&select=merchant,category,sub`) as Promise<
      Array<{ merchant: string; category: string; sub: string | null }>
    >,
  ]);

  let parsedSettings: Record<string, unknown> = {};
  const settingsRaw = propsRows.find(r => r.key === 'settings')?.value;
  if (settingsRaw) {
    try {
      parsedSettings = JSON.parse(settingsRaw) as Record<string, unknown>;
    } catch {
      parsedSettings = {};
    }
  }

  const learnings = buildArchivedLearnings({
    settings: parsedSettings,
    rules: ruleRows ?? [],
    now,
  });

  const statusPayload = {
    status: 'inactive',
    deactivatedAt: archivedAt,
    ...(reason ? { reason: reason.slice(0, 200) } : {}),
  };

  await admin('props?on_conflict=user_id,key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      { user_id: userId, key: 'account_status', value: JSON.stringify(statusPayload) },
      { user_id: userId, key: 'archived_learnings', value: JSON.stringify(learnings) },
      { user_id: userId, key: 'gmail', value: '{}' },
    ]),
  });

  // Best-effort sync to optional `public.user_profiles` table when created from schema.sql.
  try {
    await admin('user_profiles?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([
        {
          user_id: userId,
          status: 'inactive',
          deactivated_at: archivedAt,
          learnings,
          updated_at: archivedAt,
        },
      ]),
    });
  } catch {
    // Table may not exist on deployments that haven't re-run schema.sql yet; `props` already preserves state.
  }

  // Ban/deactivate the Auth user (~100 years) and free their real email so future signups create a fresh user_id
  // while preserving this old user_id row & archived learnings intact.
  const key = serviceKey();
  const base = supabaseUrl();
  const encodedId = encodeURIComponent(userId);
  let priorEmailHash: string | undefined;
  let existingMeta: Record<string, unknown> = {};
  try {
    const cur = await fetch(`${base}/auth/v1/admin/users/${encodedId}`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (cur.ok) {
      const u = (await cur.json()) as { email?: string | null; app_metadata?: Record<string, unknown> };
      existingMeta = u.app_metadata ?? {};
      if (u.email && !u.email.endsWith('@deleted.maxie.local')) {
        priorEmailHash = hashEmail(u.email);
      }
    }
  } catch {
    /* non-blocking: still archive the email placeholder below */
  }

  const r = await fetch(`${base}/auth/v1/admin/users/${encodedId}`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: archivedEmailFor(userId, now),
      email_confirm: true,
      ban_duration: '876000h',
      app_metadata: {
        ...existingMeta,
        status: 'inactive',
        deactivated_at: archivedAt,
        ...(priorEmailHash ? { prior_email_hash: priorEmailHash } : {}),
      },
    }),
  });
  if (!r.ok) {
    throw new Error('Could not deactivate auth user: ' + (await r.text()).slice(0, 200));
  }

  return { status: 'inactive', archivedAt };
}
