import { z } from "zod";

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  MUSIC_LIBRARY_PATH: z.string().min(1),
  YT_DLP_PATH: z.string().min(1),
  FFMPEG_PATH: z.string().min(1),
  MUSICBRAINZ_USER_AGENT: z.string().min(1),
  APP_PASSWORD_HASH: z.string().min(20),
  COOKIE_SECRET: z.string().min(32),
  // Listening Party WhatsApp via CallMeBot. Optional — when unset, party
  // still works locally, we just skip the notification.
  CALLMEBOT_API_KEY: z.string().optional(),
  NOTIFY_WHATSAPP_NUMBER: z.string().optional(),
  // Public URL used when generating WhatsApp join links — set to the
  // Cloudflare Tunnel hostname in production, or http://localhost:3000 in
  // dev.
  PUBLIC_APP_URL: z.string().url().default("https://kyote.fawwaz.fun"),
  // Where per-user YouTube cookie jars live. MUST be outside
  // MUSIC_LIBRARY_PATH and outside Postgres — scripts/backup.sh tars the
  // library and pg_dumps the DB, and both are mirrored offsite; a jar in
  // either would ship live Google session credentials to the backup target.
  // Defaults (in yt-cookies.ts) to ~/.config/music-universe/yt-cookies.
  YT_COOKIES_DIR: z.string().min(1).optional(),
  // playedAt is stored as UTC in a `timestamp without time zone` column, so
  // any hour-of-day analysis has to convert or it lands 8 hours out — UTC
  // 16:00 is local midnight here, which would turn a late-night listening
  // peak into an afternoon one.
  APP_TIMEZONE: z.string().min(1).default("Asia/Kuala_Lumpur"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
export type Env = z.infer<typeof Schema>;
