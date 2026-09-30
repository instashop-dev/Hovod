import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';
import { buildS3Config } from './s3-config.js';

// Credentials and endpoint are resolved once: explicit + custom for MinIO,
// omitted for AWS/ECS so the SDK uses the default credential chain and the
// regional endpoint. See s3-config.ts.
const s3Config = buildS3Config(env);

// Internal client for server-side operations (uses Docker-internal endpoint)
export const s3Client = new S3Client(s3Config);

// Public client for generating presigned URLs the browser can reach
const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
export const s3PublicClient = new S3Client({
  ...s3Config,
  ...(publicEndpoint !== undefined ? { endpoint: publicEndpoint } : {}),
});

/**
 * Auto-configure S3 bucket CORS on startup.
 * Idempotent — safe to call on every boot.
 * Public read is handled per-object via ACL: 'public-read' in the worker.
 */
export async function configureBucket(): Promise<void> {
  await s3Client.send(new PutBucketCorsCommand({
    Bucket: env.S3_BUCKET,
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: ['*'],
        AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 86400,
      }],
    },
  }));
}
