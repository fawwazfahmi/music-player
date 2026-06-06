// CallMeBot WhatsApp notifier.
//
// Setup (one-time, per recipient phone number):
//   1. On the recipient's phone, add +34 644 51 95 23 to contacts.
//   2. From that phone, send "I allow callmebot to send me messages" to
//      that contact.
//   3. A few minutes later you receive an API key in WhatsApp. Drop it
//      into CALLMEBOT_API_KEY in .env.
//   4. Set NOTIFY_WHATSAPP_NUMBER to the same recipient number in E.164
//      format (e.g. +60178231362).
//
// API: a simple GET to https://api.callmebot.com/whatsapp.php with
// { phone, text, apikey } query params. Returns 200 with HTML body even
// on errors — we treat non-OK responses as failures and log the body.
//
// All sends are best-effort and never throw upstream. A failed WhatsApp
// notification should never block the listening party itself from
// starting.

import { env } from "@/lib/env";

export interface SendWhatsAppResult {
  ok: boolean;
  /** Skipped because no API key / phone is configured. */
  skipped?: boolean;
  status?: number;
  detail?: string;
}

export async function sendWhatsApp(text: string): Promise<SendWhatsAppResult> {
  if (!env.CALLMEBOT_API_KEY || !env.NOTIFY_WHATSAPP_NUMBER) {
    console.warn("[mu] callmebot: skipped (CALLMEBOT_API_KEY or NOTIFY_WHATSAPP_NUMBER unset)");
    return { ok: false, skipped: true };
  }
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", env.NOTIFY_WHATSAPP_NUMBER);
  url.searchParams.set("text", text);
  url.searchParams.set("apikey", env.CALLMEBOT_API_KEY);

  try {
    // CallMeBot can be slow (5-15s). Give it a generous timeout but never
    // block the caller for longer than that.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    const body = await res.text();
    if (!res.ok) {
      console.warn(`[mu] callmebot: HTTP ${res.status}`, body.slice(0, 200));
      return { ok: false, status: res.status, detail: body.slice(0, 300) };
    }
    // The 'Message queued' / 'Message sent' string appears on success.
    if (/queued|sent|delivered/i.test(body)) {
      console.log(`[mu] callmebot: sent (${text.length} chars)`);
      return { ok: true, status: res.status };
    }
    // 200 OK but the body is an error page (rate limit, invalid key…).
    console.warn(`[mu] callmebot: ambiguous response`, body.slice(0, 200));
    return { ok: false, status: res.status, detail: body.slice(0, 300) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[mu] callmebot: send failed", detail);
    return { ok: false, detail };
  }
}
