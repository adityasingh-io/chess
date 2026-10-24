// The "Fetch new games" button talks to the update Worker (worker/update.ts), whose address the deployed
// build gets as VITE_UPDATE_URL. Without it (local dev, other hosts) there's no button; on the Mac,
// `uv run coach update` does the same.
import type { Started, Status } from "../../worker/update";

export type { Run, Started, Status, Waiting } from "../../worker/update";

const URL_ = import.meta.env.VITE_UPDATE_URL as string | undefined;
export const updateUrl = URL_ || null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${URL_}${path}`, { cache: "no-store", ...init });
  const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !body) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body;
}

export const updateStatus = () => call<Status>("/status");
export const startUpdate = () => call<Started>("/update", { method: "POST" });
