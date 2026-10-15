import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = import.meta.env;
// The Vercel Supabase integration names its public vars NEXT_PUBLIC_*; vite.config exposes that prefix.
const url: string | undefined = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key: string | undefined = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Null when Supabase isn't configured; the app then runs on browser storage with a demo sign-in. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
