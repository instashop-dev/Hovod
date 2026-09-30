#!/usr/bin/env tsx
/**
 * S3 configuration: AWS/ECS (default credential chain, no static keys) versus
 * local MinIO (explicit credentials, custom endpoint).
 *
 * Covers the two failure modes that silently broke AWS deployments before:
 *  - the `credentials` key leaking into the S3Client config as `undefined`,
 *    which stops the SDK from falling through to its default provider chain;
 *  - half a credential pair, which would be ignored and surface much later as
 *    a 403 in the middle of an upload.
 *
 *   npx tsx apps/api/scripts/test-s3-config.mts
 */
import assert from 'node:assert/strict';
import { buildS3Config } from '../src/s3-config.js';

let passed = 0;
const ok = (label: string) => { passed += 1; console.log(`  ok   ${label}`); };

/* ─── Env schema ─────────────────────────────────────────── */

// A complete, valid API env minus the S3 credentials and endpoint: this is the
// AWS/ECS shape. Set before importing env.js, which parses process.env on load.
const AWS_ENV = {
  DATABASE_URL: 'mysql://root:root@127.0.0.1:3306/hovod',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'hovod-vod',
  S3_PUBLIC_BASE_URL: 'https://media.example.com',
  JWT_SECRET: 'x'.repeat(32),
};

for (const [k, v] of Object.entries(AWS_ENV)) process.env[k] = v;
delete process.env.S3_ACCESS_KEY_ID;
delete process.env.S3_SECRET_ACCESS_KEY;
delete process.env.S3_ENDPOINT;

const { envSchema } = await import('../src/env.js');

const MINIO_ENV = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
};

{
  // Both credentials absent — the AWS/ECS case must boot.
  const r = envSchema.safeParse({ ...AWS_ENV });
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  ok('both credentials absent: valid');
}

{
  // Both present — the MinIO case must boot.
  const r = envSchema.safeParse({ ...AWS_ENV, ...MINIO_ENV });
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  ok('both credentials present: valid');
}

{
  const r = envSchema.safeParse({ ...AWS_ENV, S3_ACCESS_KEY_ID: 'only-the-key' });
  assert.equal(r.success, false, 'a key without a secret must be rejected');
  assert.match(r.error!.issues[0].message, /must be set together/);
  assert.equal(r.error!.issues[0].path[0], 'S3_SECRET_ACCESS_KEY');
  ok('key without secret: rejected, points at S3_SECRET_ACCESS_KEY');
}

{
  const r = envSchema.safeParse({ ...AWS_ENV, S3_SECRET_ACCESS_KEY: 'only-the-secret' });
  assert.equal(r.success, false, 'a secret without a key must be rejected');
  assert.match(r.error!.issues[0].message, /must be set together/);
  assert.equal(r.error!.issues[0].path[0], 'S3_ACCESS_KEY_ID');
  ok('secret without key: rejected, points at S3_ACCESS_KEY_ID');
}

{
  // Unchanged behaviour: playback URLs are still built from this variable, so
  // the API still refuses to boot without it.
  const r = envSchema.safeParse({ ...AWS_ENV, S3_PUBLIC_BASE_URL: undefined });
  assert.equal(r.success, false);
  ok('S3_PUBLIC_BASE_URL still required (behaviour unchanged)');
}

{
  // ECS task definitions and .env templates inject blanks for omitted variables.
  const r = envSchema.safeParse({ ...AWS_ENV, S3_ENDPOINT: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' });
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  ok('blank S3 variables are treated as unset, not invalid');
}

/* ─── Client config ──────────────────────────────────────── */

{
  // AWS/ECS: no credentials, no custom endpoint.
  const cfg = buildS3Config({ S3_REGION: 'eu-central-1' });
  assert.equal('credentials' in cfg, false, 'credentials key must be absent, not undefined');
  assert.equal('endpoint' in cfg, false, 'endpoint key must be absent, not undefined');
  assert.equal(cfg.region, 'eu-central-1');
  assert.equal(cfg.forcePathStyle, false, 'AWS uses virtual-hosted style addressing');
  ok('AWS/ECS: credentials and endpoint omitted, virtual-hosted style');
}

{
  // MinIO: explicit credentials and a custom endpoint.
  const cfg = buildS3Config({
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
  });
  assert.deepEqual(cfg.credentials, { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' });
  assert.equal(cfg.endpoint, 'http://minio:9000');
  assert.equal(cfg.forcePathStyle, true, 'custom endpoints keep path-style addressing');
  ok('MinIO: explicit credentials + custom endpoint, path style');
}

{
  // Defence in depth: buildS3Config refuses a half pair even without the schema.
  assert.throws(
    () => buildS3Config({ S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'lonely' }),
    /must be set together/,
  );
  assert.throws(
    () => buildS3Config({ S3_REGION: 'us-east-1', S3_SECRET_ACCESS_KEY: 'lonely' }),
    /must be set together/,
  );
  ok('buildS3Config rejects a half credential pair');
}

{
  // Explicit override wins over the endpoint-derived default (R2, B2, ...).
  const r2 = buildS3Config({ S3_REGION: 'auto', S3_ENDPOINT: 'https://<account>.r2.cloudflarestorage.com', S3_FORCE_PATH_STYLE: 'false' });
  assert.equal(r2.forcePathStyle, false);
  const b2 = buildS3Config({ S3_REGION: 'us-west-000', S3_ENDPOINT: 'https://s3.us-west-000.backblazeb2.com', S3_FORCE_PATH_STYLE: 'true' });
  assert.equal(b2.forcePathStyle, true);
  ok('explicit S3_FORCE_PATH_STYLE overrides the derived default');
}

console.log(`\n${passed} passed`);
