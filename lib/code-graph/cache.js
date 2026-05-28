import { createHash } from 'node:crypto';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class ASTCache {
  constructor(cachePath) {
    this.cachePath = cachePath;
    this.statCache = new Map();
  }

  hash(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  cacheFilePath(contentHash) {
    return join(this.cachePath, `${contentHash}.json`);
  }

  async get(content) {
    const h = this.hash(content);
    const path = this.cacheFilePath(h);
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async set(content, extraction) {
    const h = this.hash(content);
    const path = this.cacheFilePath(h);
    await mkdir(this.cachePath, { recursive: true });
    await writeFile(path, JSON.stringify(extraction), 'utf-8');
  }

  async setWithStat(filePath, content, extraction) {
    await this.set(content, extraction);
    try {
      const s = await stat(filePath);
      this.statCache.set(filePath, {
        size: s.size,
        mtimeMs: s.mtimeMs,
        hash: this.hash(content),
      });
    } catch { }
  }

  async isFreshByStat(filePath) {
    const cached = this.statCache.get(filePath);
    if (!cached) return false;
    try {
      const s = await stat(filePath);
      return s.size === cached.size && s.mtimeMs === cached.mtimeMs;
    } catch {
      return false;
    }
  }

  async getOrExtract(filePath, content, extractFn) {
    // Fast path: check stat
    if (await this.isFreshByStat(filePath)) {
      const cached = this.statCache.get(filePath);
      if (cached) {
        const result = await this.get(content);
        if (result) return result;
      }
    }

    // Slow path: hash and check cache
    const cached = await this.get(content);
    if (cached) {
      try {
        const s = await stat(filePath);
        this.statCache.set(filePath, {
          size: s.size,
          mtimeMs: s.mtimeMs,
          hash: this.hash(content),
        });
      } catch { }
      return cached;
    }

    // Cache miss: extract and store
    const result = await extractFn();
    await this.setWithStat(filePath, content, result);
    return result;
  }
}
