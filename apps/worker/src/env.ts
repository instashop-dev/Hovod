import 'dotenv/config';
import { z } from 'zod';

/**
 * Optional string variable where a blank value counts as *unset*.
 *
 * ECS task definitions, Compose and .env templates routinely inject an empty
 * string for a variable the operator left out. `-e S3_ENDPOINT=` on AWS must
 * mean "let the SDK resolve the endpoint", not "invalid value".
 */
const optionalVar = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

/** Exported so tests can exercise validation without booting the whole app. */
export const envSchema = z.object({
  REDIS_URL: z.string().default('redis://redis:6379'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Custom S3-compatible endpoint (MinIO). Omit on AWS for regional endpoint resolution. */
  S3_ENDPOINT: optionalVar,
  S3_REGION: z.string().min(1, 'S3_REGION is required'),
  S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
  /**
   * Static credentials for MinIO / R2 / self-hosted S3. Set BOTH, or omit BOTH on
   * AWS/ECS to let the AWS SDK use its default credential chain. One alone is an error.
   */
  S3_ACCESS_KEY_ID: optionalVar,
  S3_SECRET_ACCESS_KEY: optionalVar,
  /** Unset: path-style with a custom endpoint (MinIO), virtual-hosted style on AWS S3. */
  S3_FORCE_PATH_STYLE: optionalVar,
  /** Set to 'false' for Cloudflare R2 or buckets with Object Ownership = bucket owner enforced (no ACLs) */
  S3_PUBLIC_ACL: z.string().default('true').transform((v) => v === 'true'),
  UPLOAD_DIR: z.string().default('/data/uploads'),
  /** Scratch directory for transcoding job files (defaults to the OS temp dir / TMPDIR) */
  WORK_DIR: z.string().min(1).optional(),
  WEBHOOK_URL: z.string().url().optional(),

  /* ─── Cloud mode (plan quotas — self-host is unlimited) ── */
  HOVOD_CLOUD: z.string().default('false').transform((v) => v === 'true' || v === '1'),

  /* ─── Scaling (optional — auto-detected from hardware) ── */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).optional(),
  FFMPEG_THREADS: z.coerce.number().int().min(0).optional(),
  DB_POOL_SIZE: z.coerce.number().int().min(1).optional(),

  /* ─── AI Processing (all optional) ─────────────────────── */
  WHISPER_API_URL: z.string().url().optional(),
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.string().default('whisper-1'),
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'groq', 'custom']).optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_API_URL: z.string().url().optional(),
  AI_ENABLED: z.string().default('true').transform((v) => v === 'true'),
}).superRefine((values, ctx) => {
  // Static S3 credentials are all-or-nothing: half a pair would otherwise fall
  // through to the default credential chain and fail confusingly mid-upload.
  const hasKey = Boolean(values.S3_ACCESS_KEY_ID);
  const hasSecret = Boolean(values.S3_SECRET_ACCESS_KEY);
  if (hasKey !== hasSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasKey ? 'S3_SECRET_ACCESS_KEY' : 'S3_ACCESS_KEY_ID'],
      message:
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together — set both for ' +
        'MinIO / self-hosted S3, or set neither to use the AWS SDK default credential chain ' +
        '(ECS task role, IRSA, instance profile, ...).',
    });
  }
});

export const env = envSchema.parse(process.env);
