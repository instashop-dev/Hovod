#!/usr/bin/env tsx
/**
 * Worker-side counterpart of apps/api/scripts/test-s3-config.mts.
 *
 * The worker keeps its own copy of the S3 client, so the credential rules have
 * to hold on both sides: same all-or-nothing validation, same omission of
 * `credentials` so AWS/ECS can use the default credential chain.
 *
 *   npx tsx apps/worker/scripts/test-s3-config.mts
 */
import assert from 'node:assert/strict';
import { buildS3Config } from '../src/s3-config.js';

let passed = 0;
const ok = (label: string) => { passed += 1; console.log(`  ok   ${label}`); };

/* ─── Env schema ─────────────────────────────────────────── */

const AWS_ENV = {
  DATABASE_URL: 'mysql://root:root@127.0.0.1:3306/hovod',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'hovod-vod',
};

for (const [k, v] of Object.entries(AWS_ENV)) process.env[k] = v;
delete process.env.S3_ACCESS_KEY_ID;
delete process.env.S3_SECRET_ACCESS_KEY;
delete process.env.S3_ENDPOINT;

const { envSchema } = await import('../src/env.js');

{
  const r = envSchema.safeParse({ ...AWS_ENV });
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  ok('both credentials absent: valid');
}

{
  const r = envSchema.safeParse({
    ...AWS_ENV,
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
  });
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  ok('both credentials present: valid');
}

for (const [label, partial] of [
  ['key without secret', { S3_ACCESS_KEY_ID: 'only-the-key' }],
  ['secret without key', { S3_SECRET_ACCESS_KEY: 'only-the-secret' }],
] as const) {
  const r = envSchema.safeParse({ ...AWS_ENV, ...partial });
  assert.equal(r.success, false, `${label} must be rejected`);
  assert.match(r.error!.issues[0].message, /must be set together/);
  ok(`${label}: rejected`);
}

{
  // S3_REGION and S3_BUCKET stay required.
  assert.equal(envSchema.safeParse({ ...AWS_ENV, S3_REGION: undefined }).success, false);
  assert.equal(envSchema.safeParse({ ...AWS_ENV, S3_BUCKET: undefined }).success, false);
  ok('S3_REGION and S3_BUCKET still required');
}

{
  // ECS task definitions and .env templates inject blanks for omitted variables.
  const r = envSchema.safeParse({ ...AWS_ENV, S3_ENDPOINT: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' });
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  ok('blank S3 variables are treated as unset, not invalid');
}

/* ─── Client config ──────────────────────────────────────── */

{
  const cfg = buildS3Config({ S3_REGION: 'eu-central-1' });
  assert.equal('credentials' in cfg, false);
  assert.equal('endpoint' in cfg, false);
  assert.equal(cfg.forcePathStyle, false);
  ok('AWS/ECS: credentials and endpoint omitted');
}

{
  const cfg = buildS3Config({
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
  });
  assert.deepEqual(cfg.credentials, { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' });
  assert.equal(cfg.endpoint, 'http://minio:9000');
  assert.equal(cfg.forcePathStyle, true);
  ok('MinIO: explicit credentials + custom endpoint');
}

console.log(`\n${passed} passed`);
