import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Object storage provider abstraction (Section 14). The local
 * implementation stores files outside `public/` and never exposes a real
 * filesystem path to callers -- routes must go through opaque attachment
 * IDs resolved via the database, then read through this interface.
 *
 * A production deployment would implement the same interface against
 * Azure Blob Storage (see docs/ARCHITECTURE.md) without changing any
 * calling code.
 */
export interface ObjectStorageProvider {
  write(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

function assertSafeKey(key: string): void {
  if (
    !key ||
    key.includes("..") ||
    key.includes("/") ||
    key.includes("\\") ||
    path.isAbsolute(key)
  ) {
    throw new Error(`Unsafe object storage key: ${key}`);
  }
}

export class LocalObjectStorageProvider implements ObjectStorageProvider {
  constructor(private readonly root: string = env.OBJECT_STORAGE_ROOT) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async write(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { mode: 0o600 });
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let provider: ObjectStorageProvider | undefined;

export function getObjectStorageProvider(): ObjectStorageProvider {
  if (!provider) {
    provider = new LocalObjectStorageProvider();
  }
  return provider;
}
