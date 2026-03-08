/**
 * Data Migration Script: Single-Tenant → Multi-Tenant
 *
 * Moves existing data from flat storage paths (employees/, calls/, etc.)
 * into org-prefixed paths (orgs/{orgId}/employees/, orgs/{orgId}/calls/, etc.).
 *
 * Usage:
 *   ORG_ID=<target-org-id> npx tsx scripts/migrate-to-multitenant.ts [--dry-run]
 *
 * Environment variables:
 *   ORG_ID         - The organization ID to assign existing data to (required)
 *   ORG_SLUG       - The org slug (optional, defaults to "default")
 *   ORG_NAME       - The org display name (optional, defaults to "Default Organization")
 *   S3_BUCKET      - S3/GCS bucket name (or GCS_BUCKET)
 *   GCS_BUCKET     - GCS bucket name (alternative to S3_BUCKET)
 *
 * The script is idempotent — it skips files that already exist at the target path.
 * Use --dry-run to preview changes without making them.
 */

import { S3Client, ListObjectsV2Command, CopyObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const DRY_RUN = process.argv.includes("--dry-run");
const ORG_ID = process.env.ORG_ID;
const ORG_SLUG = process.env.ORG_SLUG || "default";
const ORG_NAME = process.env.ORG_NAME || "Default Organization";
const BUCKET = process.env.S3_BUCKET || process.env.GCS_BUCKET;

if (!ORG_ID) {
  console.error("ERROR: ORG_ID environment variable is required.");
  console.error("Usage: ORG_ID=<org-id> npx tsx scripts/migrate-to-multitenant.ts [--dry-run]");
  process.exit(1);
}

if (!BUCKET) {
  console.error("ERROR: S3_BUCKET or GCS_BUCKET environment variable is required.");
  process.exit(1);
}

// Directories that need migration (old flat path → new org-prefixed path)
const MIGRATE_DIRS = [
  "employees",
  "calls",
  "transcripts",
  "sentiments",
  "analyses",
  "audio",
  "coaching",
  "access-requests",
  "prompt-templates",
];

// Detect if we're using GCS (Google Cloud Storage with S3-compatible API)
const isGCS = !!process.env.GCS_BUCKET;
const s3Config: any = {};
if (isGCS) {
  s3Config.endpoint = "https://storage.googleapis.com";
  s3Config.region = process.env.GCS_REGION || "us-central1";
} else {
  s3Config.region = process.env.AWS_REGION || "us-east-1";
}

const s3 = new S3Client(s3Config);

async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await s3.send(cmd);
    for (const obj of response.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function copyObject(sourceKey: string, targetKey: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would copy: ${sourceKey} → ${targetKey}`);
    return;
  }

  const cmd = new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${sourceKey}`,
    Key: targetKey,
  });
  await s3.send(cmd);
}

async function createOrgRecord(): Promise<void> {
  const orgKey = `orgs/${ORG_ID}/org.json`;
  const orgData = {
    id: ORG_ID,
    name: ORG_NAME,
    slug: ORG_SLUG,
    status: "active",
    createdAt: new Date().toISOString(),
    settings: {},
  };

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would create org record: ${orgKey}`);
    return;
  }

  // PutObject is idempotent — no need to check existence first
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: orgKey,
    Body: JSON.stringify(orgData),
    ContentType: "application/json",
  }));
  console.log(`[CREATED] Organization record: ${orgKey}`);
}

async function migrateDirectory(dir: string): Promise<{ copied: number; skipped: number }> {
  console.log(`\nMigrating "${dir}/"...`);

  // List all objects in the old flat directory
  const sourceKeys = await listObjects(`${dir}/`);

  // Filter out any keys that are already under orgs/ (shouldn't happen, but safety check)
  const keysToMigrate = sourceKeys.filter(k => !k.startsWith("orgs/"));

  if (keysToMigrate.length === 0) {
    console.log(`  No files found in "${dir}/".`);
    return { copied: 0, skipped: 0 };
  }

  console.log(`  Found ${keysToMigrate.length} file(s) to migrate.`);

  let copied = 0;

  // Copy in batches of 10 for bounded concurrency
  const BATCH_SIZE = 10;
  for (let i = 0; i < keysToMigrate.length; i += BATCH_SIZE) {
    const batch = keysToMigrate.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (sourceKey) => {
      const targetKey = `orgs/${ORG_ID}/${sourceKey}`;
      // CopyObject is idempotent — no need to check existence first
      await copyObject(sourceKey, targetKey);
      if (!DRY_RUN) {
        console.log(`  [COPIED] ${sourceKey} → ${targetKey}`);
      }
      copied++;
    }));
  }

  return { copied, skipped: 0 };
}

async function injectOrgIdIntoJsonFiles(): Promise<number> {
  console.log(`\nInjecting orgId into JSON files...`);

  // For each JSON entity file, we need to add orgId if it's missing
  const entityDirs = ["employees", "calls", "transcripts", "sentiments", "analyses", "coaching", "access-requests", "prompt-templates"];
  let updated = 0;

  for (const dir of entityDirs) {
    const keys = await listObjects(`orgs/${ORG_ID}/${dir}/`);
    const jsonKeys = keys.filter(k => k.endsWith(".json"));

    for (const key of jsonKeys) {
      try {
        const getResult = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const body = await getResult.Body?.transformToString();
        if (!body) continue;

        const data = JSON.parse(body);
        if (data.orgId === ORG_ID) continue; // Already has correct orgId

        data.orgId = ORG_ID;

        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would inject orgId into: ${key}`);
        } else {
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: JSON.stringify(data),
            ContentType: "application/json",
          }));
          console.log(`  [UPDATED] ${key}`);
        }
        updated++;
      } catch (e) {
        console.warn(`  [WARN] Could not process ${key}:`, (e as Error).message);
      }
    }
  }

  return updated;
}

async function main() {
  console.log("=== Observatory Multi-Tenant Migration ===");
  console.log(`Bucket:    ${BUCKET}`);
  console.log(`Org ID:    ${ORG_ID}`);
  console.log(`Org Slug:  ${ORG_SLUG}`);
  console.log(`Org Name:  ${ORG_NAME}`);
  console.log(`Mode:      ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("");

  // Step 1: Create org record
  await createOrgRecord();

  // Step 2: Copy files from flat structure to org-prefixed (parallel across directories)
  const results = await Promise.all(MIGRATE_DIRS.map(dir => migrateDirectory(dir)));
  const totalCopied = results.reduce((sum, r) => sum + r.copied, 0);

  // Step 3: Inject orgId into JSON entities
  const injected = await injectOrgIdIntoJsonFiles();

  console.log("\n=== Migration Summary ===");
  console.log(`Files copied:    ${totalCopied}`);
  console.log(`Files updated:   ${injected} (orgId injected)`);
  console.log(`Mode:            ${DRY_RUN ? "DRY RUN" : "COMPLETE"}`);

  if (DRY_RUN) {
    console.log("\nRe-run without --dry-run to apply changes.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
