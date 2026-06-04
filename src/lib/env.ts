import { z } from "zod";

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  MUSIC_LIBRARY_PATH: z.string().min(1),
  YT_DLP_PATH: z.string().min(1),
  FFMPEG_PATH: z.string().min(1),
  MUSICBRAINZ_USER_AGENT: z.string().min(1),
  APP_PASSWORD_HASH: z.string().min(20),
  COOKIE_SECRET: z.string().min(32),
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
