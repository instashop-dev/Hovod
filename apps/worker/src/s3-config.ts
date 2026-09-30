import type { S3ClientConfig } from '@aws-sdk/client-s3';

/**
 * S3 client configuration.
 *
 * Deliberately free of `env` imports and side effects: the API builds two
 * clients (internal + presigning) and the worker a third, and keeping the
 * decision in one pure function makes the AWS/MinIO split unit-testable
 * (see `scripts/test-s3-config.mts`).
 *
 * Credentials:
 *   - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` both set → explicit
 *     credentials (MinIO, Cloudflare R2, any self-hosted S3).
 *   - neither set → the `credentials` key is omitted from the config entirely,
 *     so the AWS SDK resolves credentials itself: ECS task role, IRSA, EC2
 *     instance profile, SSO, `~/.aws/credentials`, … Nothing here generates,
 *     defaults, or reaches for the ECS metadata endpoint.
 *   - exactly one set → rejected. The Zod schemas already refuse this during
 *     env validation; the guard here is defence in depth for any caller that
 *     builds a config without going through `env`.
 *
 * Endpoint:
 *   - `S3_ENDPOINT` set → custom endpoint, exactly as before (MinIO).
 *   - `S3_ENDPOINT` unset → the key is omitted and the AWS SDK resolves the
 *     regional S3 endpoint itself.
 *
 * Path style: a custom endpoint implies path-style addressing, plain AWS S3
 * implies virtual-hosted style. `S3_FORCE_PATH_STYLE` overrides both when set
 * (R2 and other S3-compatible providers want an explicit value).
 */

/** The subset of the app env schema this module reads, as raw strings. */
export interface S3EnvLike {
  S3_REGION: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  /** Raw `'true'` / `'false'`; undefined means "derive from the endpoint". */
  S3_FORCE_PATH_STYLE?: string;
}

export function buildS3Config(e: S3EnvLike): S3ClientConfig {
  const hasKey = e.S3_ACCESS_KEY_ID !== undefined;
  const hasSecret = e.S3_SECRET_ACCESS_KEY !== undefined;

  if (hasKey !== hasSecret) {
    throw new Error(
      'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together — ' +
        'set both for MinIO/self-hosted S3, or set neither to use the AWS SDK default credential chain ' +
        '(ECS task role, IRSA, instance profile, ...).',
    );
  }

  const credentials = hasKey
    ? { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! }
    : undefined;

  const forcePathStyle = e.S3_FORCE_PATH_STYLE !== undefined
    ? e.S3_FORCE_PATH_STYLE === 'true'
    // Custom endpoint (MinIO) → path style; plain AWS S3 → virtual-hosted style.
    : e.S3_ENDPOINT !== undefined;

  return {
    region: e.S3_REGION,
    // Conditional spreads, not `credentials: undefined`: the key must be
    // absent so the SDK falls through to its default credential provider chain.
    ...(credentials ? { credentials } : {}),
    ...(e.S3_ENDPOINT !== undefined ? { endpoint: e.S3_ENDPOINT } : {}),
    forcePathStyle,
  };
}
