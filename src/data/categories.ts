import { IC } from '../components/Icon';

export type CategoryType = 'fixed' | 'variable';

export type Category = {
  name: string;
  type: CategoryType;
  /** Limit as % of monthly income. */
  limitPct: number;
  /** Bars, donut, legend dots, dropdown outline. */
  color: string;
  /** Icon chip and dropdown background. */
  tint: string;
  /** Icon and dropdown text on `tint` (≥ 4.5:1). */
  ink: string;
  icon: string;
  /** Created by you (saved in settings), not built in. */
  custom?: boolean;
  /** Built-in only: the limit before any change you made in settings. */
  defaultLimitPct?: number;
  /** The limit follows a schedule instead of a % of income (Installments: what's due this cycle). */
  auto?: boolean;
};

/** A category you created, as saved in settings. `icon` is a key of `IC`. */
export type CustomCategory = { name: string; type: CategoryType; limitPct: number; icon: string; color: string };

export type Hue = Pick<Category, 'color' | 'tint' | 'ink'>;

export const INCOME_CATEGORY = 'Income';
/** Money moved between your own accounts: shown in Activity, never counted as spending or income. */
export const TRANSFER_CATEGORY = 'Transfer';
/** Paying a credit card bill from the bank: a transfer to the card, never spending (the purchases already were). */
export const CC_PAYMENT_CATEGORY = 'CC Payment';
/** Money moved to your brokers: the Investing pocket. Like a transfer, never spending. */
export const INVESTMENT_CATEGORY = 'Investment';
/** Money you moved to your savings account: the only thing counted as saved. Like a transfer, never spending. */
export const SAVINGS_CATEGORY = 'Savings';
/** A card purchase paid in installments: the purchase itself isn't spending, its monthly payments are. */
export const INSTALLMENT_CATEGORY = 'Installment';
/** A fixed bill whose plan is exactly the installment payments due each cycle (price and interest). */
export const INSTALLMENTS_CATEGORY = 'Installments';
/** Where card fees go (and installment interest, before installments had their own category). */
export const INTEREST_CATEGORY = 'Interest & fees';
/** Categories a transaction can be moved to besides the budget ones. */
export const OTHER_CATEGORIES = [TRANSFER_CATEGORY, SAVINGS_CATEGORY, INVESTMENT_CATEGORY, INCOME_CATEGORY];
/** How a non-budget category reads in menus. */
export const categoryLabel = (name: string) => (name === TRANSFER_CATEGORY ? 'Transfer (own accounts)' : name === SAVINGS_CATEGORY ? 'Transfer (savings)' : name);
/** Share of income you aim to move to savings each cycle; set from your settings (see SettingsProvider). */
export let SAVINGS_TARGET_PCT = 60;
export const setSavingsTarget = (pct: number) => {
  SAVINGS_TARGET_PCT = pct;
};

/**
 * One hue per category: Maxie's eight category slots in order, then Other, then six extra earth tones for the
 * categories past eight (the app has more than the system's eight). Each is a CSS variable with its own light and
 * dark step (styles/global.css). A new category takes the first hue no category uses yet.
 */
export const HUES: Hue[] = [
  { color: 'var(--category-1)', tint: 'var(--category-1-soft)', ink: 'var(--category-1)' }, // Terracotta
  { color: 'var(--category-2)', tint: 'var(--category-2-soft)', ink: 'var(--category-2)' }, // Spruce
  { color: 'var(--category-3)', tint: 'var(--category-3-soft)', ink: 'var(--category-3)' }, // Heather
  { color: 'var(--category-4)', tint: 'var(--category-4-soft)', ink: 'var(--category-4)' }, // Ochre
  { color: 'var(--category-5)', tint: 'var(--category-5-soft)', ink: 'var(--category-5)' }, // Fig
  { color: 'var(--category-6)', tint: 'var(--category-6-soft)', ink: 'var(--category-6)' }, // Moss
  { color: 'var(--category-7)', tint: 'var(--category-7-soft)', ink: 'var(--category-7)' }, // Denim
  { color: 'var(--category-8)', tint: 'var(--category-8-soft)', ink: 'var(--category-8)' }, // Umber
  { color: 'var(--category-other)', tint: 'var(--category-other-soft)', ink: 'var(--category-other)' }, // Other
  { color: 'var(--category-9)', tint: 'var(--category-9-soft)', ink: 'var(--category-9)' }, // Slate
  { color: 'var(--category-10)', tint: 'var(--category-10-soft)', ink: 'var(--category-10)' }, // Gold
  { color: 'var(--category-11)', tint: 'var(--category-11-soft)', ink: 'var(--category-11)' }, // Walnut
  { color: 'var(--category-12)', tint: 'var(--category-12-soft)', ink: 'var(--category-12)' }, // Lagoon
  { color: 'var(--category-13)', tint: 'var(--category-13-soft)', ink: 'var(--category-13)' }, // Plum
  { color: 'var(--category-14)', tint: 'var(--category-14-soft)', ink: 'var(--category-14)' }, // Rose
];
export const HUE_NAMES = ["Terracotta", "Spruce", "Heather", "Ochre", "Fig", "Moss", "Denim", "Umber", "Other", "Slate", "Gold", "Walnut", "Lagoon", "Plum", "Rose"];

/** The hex colours from before Maxie, as still saved in settings, and the hue each became. */
const LEGACY_HUES: Record<string, number> = {
  '#0b7a6a': 0, '#e59a1a': 3, '#3b74c4': 6, '#7b5cc4': 2, '#4a9a3a': 5, '#d9643a': 7, '#1f97b8': 1, '#c4507e': 4,
  '#7d8a87': 8, '#5560d0': 10, '#8a9a1f': 9, '#a0703c': 11, '#b04fb8': 12, '#5a7389': 13, '#c9a227': 14,
};
/** A saved colour as one of today's hues (old hex values carry over). */
export const hueOf = (color?: string) => (color ? (HUES.find(h => h.color === color) ?? (color in LEGACY_HUES ? HUES[LEGACY_HUES[color]] : undefined)) : undefined);

export const nextHue = (cats: Hue[]): Hue => HUES.find(h => !cats.some(c => c.color === h.color)) ?? HUES[cats.length % HUES.length];

/** Icons you can pick for a new category (keys of `IC`). */
export const CATEGORY_ICONS = [
  'home', 'zap', 'shield', 'repeat', 'basket', 'utensils', 'coffee', 'takeout', 'nav', 'car', 'plane', 'bag', 'shirt', 'gift', 'heart', 'pill',
  'dumbbell', 'book', 'graduation', 'film', 'music', 'gamepad', 'phone', 'wrench', 'card', 'coins', 'wallet', 'piggy', 'calendar', 'sparkle',
] as const;

const BUILT_IN: Category[] = [
  { name: 'Housing', type: 'fixed', limitPct: 14, ...HUES[0], icon: IC.home },
  { name: 'Utilities', type: 'fixed', limitPct: 3, ...HUES[3], icon: IC.zap },
  { name: 'Insurance', type: 'fixed', limitPct: 2, ...HUES[6], icon: IC.shield },
  { name: 'Subscriptions', type: 'fixed', limitPct: 1, ...HUES[2], icon: IC.repeat },
  // Monthly payments of purchases you split into installments; the plan is whatever's due this cycle.
  { name: 'Installments', type: 'fixed', limitPct: 0, ...HUES[10], icon: IC.calendar, auto: true },
  { name: 'Groceries', type: 'variable', limitPct: 7, ...HUES[5], icon: IC.basket },
  { name: 'Dining', type: 'variable', limitPct: 2, ...HUES[7], icon: IC.utensils },
  { name: 'Cafe', type: 'variable', limitPct: 1, ...HUES[11], icon: IC.coffee },
  { name: 'Take out', type: 'variable', limitPct: 1, ...HUES[14], icon: IC.takeout },
  { name: 'Transport', type: 'variable', limitPct: 3, ...HUES[1], icon: IC.nav },
  // Car service and repairs (and home fixes): irregular, so kept apart from everyday transport.
  { name: 'Maintenance', type: 'variable', limitPct: 1, ...HUES[9], icon: IC.wrench },
  { name: 'Shopping', type: 'variable', limitPct: 3, ...HUES[4], icon: IC.bag },
  { name: 'Buffer', type: 'variable', limitPct: 1.5, ...HUES[8], icon: IC.wallet },
  // Installment interest and card fees, kept apart so they don't inflate what you bought.
  { name: 'Interest & fees', type: 'variable', limitPct: 0.5, ...HUES[13], icon: IC.card },
];

/** Sub-categories to start with; you can change them in each category's edit dialog. */
export const DEFAULT_SUBCATEGORIES: Record<string, string[]> = {
  Transport: ['Fuel', 'Parking & toll', 'Rides & transit'],
  Shopping: ['Clothes', 'Home', 'Electronics'],
  Maintenance: ['Car', 'Home'],
};

/** A category filter can name a sub-category too: "Transport › Fuel". */
const SUB_SEP = ' › ';
export const catFilter = (cat: string, sub?: string | null) => (sub ? cat + SUB_SEP + sub : cat);
export const parseCatFilter = (v: string) => {
  const [cat, sub] = v.split(SUB_SEP);
  return { cat, sub: sub as string | undefined };
};

/** A guess from the merchant's name when you haven't picked a sub-category and no rule names one. */
export const AUTO_SUBS: [category: string, sub: string, match: RegExp][] = [
  ['Transport', 'Fuel', /\b(pertamina|shell|spbu|bensin|bbm|fuel|vivo|bp akr)\b/i],
  ['Transport', 'Parking & toll', /\b(parkir|parking|e-?toll|tol|flazz|e-?money|tapcash|brizzi|jasa ?marga)\b/i],
  ['Transport', 'Rides & transit', /\b(grab|gojek|goride|gocar|grabbike|grabcar|bluebird|taxi|taksi|maxim|krl|mrt|lrt|transjakarta|commuter|kai|damri)\b/i],
  ['Maintenance', 'Car', /\b(toyota|honda|auto ?2000|bengkel|bodyrepai\w*|tambal ban|spare ?parts?|servis|ganti oli)\b/i],
  ['Maintenance', 'Home', /\b(cuci ac|service ac|tukang|plumber|ace hardware|mr ?diy)\b/i],
  ['Shopping', 'Clothes', /\b(uniqlo|zara|h&m|zalora|erigo|cotton ink|sepatu|shoes|baju)\b/i],
  ['Shopping', 'Home', /\b(ikea|informa|ace hardware|mr ?diy|kawan lama)\b/i],
  ['Shopping', 'Electronics', /\b(ibox|erafone|digimap|samsung|electronic\w*|elektronik)\b/i],
];

/**
 * Built-in categories (with your limit and colour changes) followed by yours.
 * Reassigned by `applyCategorySettings`; imports see the new list.
 */
export let CATEGORIES: Category[] = BUILT_IN;

/**
 * Built-in categories are the ones Gmail import assigns automatically (Parse.js CATEGORY_RULES, Buffer as the
 * fallback), so their name and icon can't change and they can't be deleted. Their limit and colour can.
 */
export const isBuiltIn = (name: string) => BUILT_IN.some(c => c.name === name);
export const builtInCategory = (name: string) => BUILT_IN.find(c => c.name === name);

export function toCategory(c: CustomCategory): Category {
  const hue = hueOf(c.color) ?? HUES[8];
  return { name: c.name, type: c.type, limitPct: c.limitPct, ...hue, icon: IC[c.icon as keyof typeof IC] ?? IC.wallet, custom: true };
}

/**
 * Your changes to built-in categories, as saved in settings. `fixedStart: 'empty'` (accounts made after fixed
 * bills became opt-in): built-in fixed bills start at 0 until you set them, instead of a guessed share of income.
 */
export type BuiltInOverrides = { limitOverrides?: Record<string, number>; colorOverrides?: Record<string, string>; fixedStart?: 'empty' };

/** Called whenever settings load or change (see SettingsProvider). */
export function applyCategorySettings(custom: CustomCategory[] = [], { limitOverrides = {}, colorOverrides = {}, fixedStart }: BuiltInOverrides = {}) {
  const builtIn = BUILT_IN.map(c => {
    const hue = hueOf(colorOverrides[c.name]);
    const start = fixedStart === 'empty' && c.type === 'fixed' && !c.auto ? 0 : c.limitPct;
    return { ...c, ...(hue ?? {}), limitPct: limitOverrides[c.name] ?? start, defaultLimitPct: start };
  });
  // A category you made before it became built in (e.g. your own "Cafe") is now the built-in one.
  CATEGORIES = [...builtIn, ...custom.filter(c => !isBuiltIn(c.name)).map(toCategory)];
}

/** Names a new category can't take. */
export const isReservedName = (n: string) => [...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES, CC_PAYMENT_CATEGORY, INSTALLMENT_CATEGORY].some(x => x.toLowerCase() === n.trim().toLowerCase());

export const categoryByName = (n: string) => CATEGORIES.find(c => c.name === n);

/**
 * Ready-made categories for "New category": name, icon, a starting limit, sub-categories and merchants that
 * usually belong there. Creating one also adds a merchant rule for each, so their transactions sort themselves.
 * Rules match whole words inside a merchant's name (letters only: digits and dots are dropped, so "tiket.com" is "tiket com") ("kimia farma" catches "KIMIA FARMA APOTEK 123").
 */
export type CategoryTemplate = { name: string; icon: (typeof CATEGORY_ICONS)[number]; type: CategoryType; limitPct: number; subs: string[]; merchants: string[] };

export const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  { name: 'Health', icon: 'pill', type: 'variable', limitPct: 2, subs: ['Doctor', 'Pharmacy', 'Lab & checkup'], merchants: ['kimia farma', 'guardian', 'century', 'watsons', 'halodoc', 'alodokter', 'apotek', 'klinik', 'rumah sakit', 'siloam', 'mitra keluarga', 'hermina', 'prodia'] },
  { name: 'Fitness', icon: 'dumbbell', type: 'fixed', limitPct: 1, subs: ['Gym', 'Classes', 'Gear'], merchants: ['fitness first', 'celebrity fitness', 'anytime fitness', 'gold gym', 'ftl gym', 'decathlon', 'sports station'] },
  { name: 'Personal care', icon: 'sparkle', type: 'variable', limitPct: 1, subs: ['Haircut', 'Skincare', 'Spa'], merchants: ['barbershop', 'barber', 'salon', 'sociolla', 'the body shop', 'innisfree', 'erha', 'zap clinic'] },
  { name: 'Entertainment', icon: 'film', type: 'variable', limitPct: 1.5, subs: ['Movies', 'Games', 'Events'], merchants: ['cgv', 'cinema xxi', 'xxi', 'cinepolis', 'steam', 'playstation', 'nintendo', 'loket', 'timezone', 'karaoke'] },
  { name: 'Travel', icon: 'plane', type: 'variable', limitPct: 3, subs: ['Flights', 'Hotels', 'Activities'], merchants: ['traveloka', 'tiket com', 'airasia', 'garuda', 'citilink', 'lion air', 'batik air', 'agoda', 'booking com', 'airbnb', 'pegipegi'] },
  { name: 'Education', icon: 'graduation', type: 'variable', limitPct: 1, subs: ['Courses', 'Books', 'School fees'], merchants: ['gramedia', 'periplus', 'udemy', 'coursera', 'ruangguru', 'zenius', 'kindle'] },
  { name: 'Family', icon: 'heart', type: 'fixed', limitPct: 5, subs: ['Parents', 'Kids', 'Household help'], merchants: [] },
  { name: 'Kids', icon: 'gamepad', type: 'variable', limitPct: 2, subs: ['School', 'Toys', 'Baby needs'], merchants: ['mothercare', 'toys kingdom', 'kiddy cuts', 'babyshop'] },
  { name: 'Gifts & giving', icon: 'gift', type: 'variable', limitPct: 1, subs: ['Gifts', 'Zakat & sedekah', 'Donations'], merchants: ['kitabisa', 'baznas', 'dompet dhuafa', 'rumah zakat'] },
  { name: 'Pets', icon: 'heart', type: 'variable', limitPct: 0.5, subs: ['Food', 'Vet', 'Grooming'], merchants: ['pet shop', 'petshop', 'pet kingdom', 'drh'] },
  { name: 'Phone & internet', icon: 'phone', type: 'fixed', limitPct: 1, subs: ['Mobile', 'Home internet'], merchants: ['telkomsel', 'indihome', 'xl axiata', 'xlsmart', 'indosat', 'smartfren', 'first media', 'biznet', 'myrepublic'] },
  { name: 'Hobbies', icon: 'music', type: 'variable', limitPct: 1, subs: ['Music', 'Photography', 'Crafts'], merchants: [] },
  { name: 'Home & living', icon: 'home', type: 'variable', limitPct: 1.5, subs: ['Furniture', 'Cleaning', 'Laundry'], merchants: ['laundry', 'laundromat', 'ikea', 'informa', 'jysk', 'courts'] },
  { name: 'Car', icon: 'car', type: 'fixed', limitPct: 2, subs: ['Loan', 'Tax & insurance', 'Wash'], merchants: ['cuci mobil', 'car wash', 'samsat'] },
  { name: 'Work', icon: 'book', type: 'variable', limitPct: 1, subs: ['Tools', 'Coworking', 'Travel'], merchants: ['wework', 'cohive', 'go work'] },
];
