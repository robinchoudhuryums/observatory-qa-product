/**
 * AWS S3 client using @aws-sdk/client-s3.
 *
 * Authentication via standard AWS env vars:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   (Optional: AWS_SESSION_TOKEN for temporary credentials)
 *
 * HIPAA: S3 is HIPAA-eligible under the AWS BAA.
 * All PUTs enforce AES256 server-side encryption at rest.
 */
import {
  S3Client as AwsS3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { logger } from "./logger";

export class S3Client {
  private client: AwsS3Client;
  private bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;

    const region = process.env.AWS_REGION || "us-east-1";

    // Build credential provider chain: env vars first, then EC2 instance profile
    let credentials: AwsCredentialIdentityProvider;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      credentials = fromEnv();
    } else {
      // Fall back to EC2 instance metadata (IMDSv2)
      credentials = fromInstanceMetadata({ timeout: 3000, maxRetries: 1 });
    }

    this.client = new AwsS3Client({ region, credentials });
  }

  /** Upload a JSON object */
  async uploadJson(objectName: string, data: unknown): Promise<void> {
    const body = JSON.stringify(data);
    await this.putObject(objectName, Buffer.from(body, "utf-8"), "application/json");
  }

  /** Upload a binary file (audio, etc.) */
  async uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.putObject(objectName, buffer, contentType);
  }

  /** Download and parse a JSON object. Returns undefined if not found. */
  async downloadJson<T>(objectName: string): Promise<T | undefined> {
    const body = await this.getObject(objectName);
    if (!body) return undefined;
    const text = await body.transformToString("utf-8");
    return JSON.parse(text) as T;
  }

  /** Download a raw binary file. Returns undefined if not found. */
  async downloadFile(objectName: string): Promise<Buffer | undefined> {
    const body = await this.getObject(objectName);
    if (!body) return undefined;
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /** List all objects with a given prefix */
  async listObjects(prefix: string): Promise<string[]> {
    const names: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) names.push(obj.Key);
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return names;
  }

  /** List objects with metadata (name, size, updated) */
  async listObjectsWithMetadata(prefix: string): Promise<Array<{ name: string; size: string; updated: string }>> {
    const items: Array<{ name: string; size: string; updated: string }> = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      if (response.Contents) {
        for (const obj of response.Contents) {
          items.push({
            name: obj.Key || "",
            size: String(obj.Size ?? "0"),
            updated: obj.LastModified?.toISOString() || "",
          });
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return items;
  }

  /** List and download all JSON objects with a given prefix */
  async listAndDownloadJson<T>(prefix: string): Promise<T[]> {
    const names = await this.listObjects(prefix);
    const results: T[] = [];

    // Download in parallel batches of 10
    for (let i = 0; i < names.length; i += 10) {
      const batch = names.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          try {
            return await this.downloadJson<T>(name);
          } catch {
            return undefined;
          }
        })
      );
      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    return results;
  }

  /** Delete an object. Ignores 404 (already deleted). */
  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: objectName,
        }),
      );
    } catch (err: any) {
      // S3 DELETE doesn't normally error on missing objects, but handle edge cases
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        return;
      }
      throw new Error(`S3 delete failed for ${objectName}: ${err?.message?.substring(0, 200) || "unknown error"}`);
    }
  }

  /** Delete all objects with a given prefix */
  async deleteByPrefix(prefix: string): Promise<void> {
    const names = await this.listObjects(prefix);
    await Promise.all(names.map((name) => this.deleteObject(name)));
  }

  get bucket() {
    return this.bucketName;
  }

  // --- Core S3 operations ---

  private async putObject(objectName: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: objectName,
          Body: body,
          ContentType: contentType,
          // HIPAA: Enforce server-side encryption at rest for all uploaded objects
          ServerSideEncryption: "AES256",
        }),
      );
    } catch (err: any) {
      throw new Error(`S3 upload failed for ${objectName}: ${err?.message?.substring(0, 200) || "unknown error"}`);
    }
  }

  private async getObject(objectName: string): Promise<any | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: objectName,
        }),
      );
      return response.Body;
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        return undefined;
      }
      if (err?.$metadata?.httpStatusCode === 403) {
        logger.error({ objectName }, "S3 access denied (403) — check IAM permissions");
        return undefined;
      }
      throw new Error(`S3 download failed for ${objectName}: ${err?.message?.substring(0, 200) || "unknown error"}`);
    }
  }
}
