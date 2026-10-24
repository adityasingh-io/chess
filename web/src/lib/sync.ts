// Progress sync through Supabase (PLAN.md: free plan, email magic link, sign-ups off once my account
// exists, row-level security). Off unless the build has VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY;
// the publishable key is meant for the browser, and no other key ever goes in the bundle. The device's copy
// stays the source of truth: a sync pulls the server's copy, merges it in (lib/progress.ts merge) and pushes
// the result. The Supabase client loads only when sync is configured.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProgress, merge, normalise, setProgress } from "./progress";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const syncConfigured = !!(URL_ && KEY);
const TABLE = "progress";
const EVENT = "coach-sync";

export type SyncState = { signedIn: boolean; email: string | null; busy: boolean; last: number | null; error: string | null };
let status: SyncState = { signedIn: false, email: null, busy: false, last: null, error: null };
const set = (s: Partial<SyncState>) => { status = { ...status, ...s }; window.dispatchEvent(new Event(EVENT)); };
export const getSyncState = () => status;
export function onSyncState(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

let client: Promise<SupabaseClient> | null = null;
function supabase(): Promise<SupabaseClient> {
  if (!syncConfigured) return Promise.reject(new Error("Sync isn't configured for this build."));
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
  return client;
}

/** Email me a sign-in link. New accounts can't be made from the app (shouldCreateUser: false). */
export async function sendLink(email: string) {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOtp({
    email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}settings` },
  });
  if (error) throw error;
}

export async function signOut() {
  await (await supabase()).auth.signOut();
  set({ signedIn: false, email: null });
}

/** Pull, merge, push. Safe to call often; does nothing while signed out or offline. */
export async function syncNow(): Promise<void> {
  if (!syncConfigured || status.busy || !navigator.onLine) return;
  set({ busy: true, error: null });
  try {
    const sb = await supabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { set({ signedIn: false, email: null }); return; }
    set({ signedIn: true, email: session.user.email ?? null });
    const { data, error } = await sb.from(TABLE).select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const local = getProgress();
    const merged = data?.data ? merge(local, normalise(data.data)) : local;
    // Only a real change is applied, and applying it doesn't count as a new change to sync.
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      applying = true;
      try { setProgress(merged); } finally { applying = false; }
    }
    const { error: upError } = await sb.from(TABLE).upsert({ user_id: session.user.id, data: merged, updated_at: new Date().toISOString() });
    if (upError) throw upError;
    set({ last: Date.now() });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    set({ busy: false });
  }
}

let timer: number | undefined;
let applying = false;
/** Sync at start, when the device comes back online, and a few seconds after each change. */
export function startSync() {
  if (!syncConfigured) return;
  void supabase().then((sb) => sb.auth.onAuthStateChange((_event, session) => {
    set({ signedIn: !!session, email: session?.user.email ?? null });
    // Supabase asks that the callback not await its other calls directly, so the sync runs just after it.
    if (session) window.setTimeout(() => void syncNow(), 0);
  }));
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("coach-progress", () => {
    if (applying) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(), 5000);
  });
}
