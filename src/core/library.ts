import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { INDEX_FILE, LIBRARY_DIR } from '../config.js';
import { safeName, slugify } from './slug.js';
import type { IndexEntry } from './types.js';

export type Owned = 'have' | 'stale' | 'none';

/** The fixed library root and its global index.json (spec §4). */
export class Library {
  readonly dir = LIBRARY_DIR;
  private entries: IndexEntry[] = [];
  private byId = new Map<string, IndexEntry>();

  private constructor() {}

  static async open(): Promise<Library> {
    const lib = new Library();
    await fsp.mkdir(LIBRARY_DIR, { recursive: true });
    try {
      const raw: unknown = JSON.parse(await fsp.readFile(INDEX_FILE, 'utf8'));
      if (Array.isArray(raw)) lib.setEntries(raw.filter(isEntry));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Unreadable index: keep a copy for the user, start from an empty one.
        await fsp.copyFile(INDEX_FILE, `${INDEX_FILE}.corrupt`).catch(() => undefined);
      }
      await lib.save();
    }
    return lib;
  }

  get size(): number {
    return this.entries.length;
  }

  abs(rel: string): string {
    return path.join(LIBRARY_DIR, ...rel.split('/'));
  }

  /** Spec §2.4: is the id indexed, and is the indexed file still on disk? A stale entry is dropped. */
  async check(id: number | string): Promise<Owned> {
    const entry = this.byId.get(String(id));
    if (!entry) return 'none';
    if (await exists(this.abs(entry.path))) return 'have';
    this.remove(entry.id);
    await this.save();
    return 'stale';
  }

  /** Upsert by id after a successful download. */
  async record(entry: IndexEntry): Promise<void> {
    this.remove(entry.id);
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    await this.save();
  }

  /** `{curator}/{uploader}/{title}.{ext}`, never clobbering a different track that has the same slug. */
  target(curator: string, uploader: string, title: string, id: number, ext: string): { rel: string; abs: string } {
    const dir = `${safeName(curator)}/${safeName(uploader)}`;
    const base = slugify(title, `track-${id}`);
    let rel = `${dir}/${base}.${ext}`;
    if (fs.existsSync(this.abs(rel)) && this.ownerOf(rel) !== String(id)) rel = `${dir}/${base}-${id}.${ext}`;
    return { rel, abs: this.abs(rel) };
  }

  private ownerOf(rel: string): string | undefined {
    return this.entries.find((e) => e.path === rel)?.id;
  }

  private remove(id: string): void {
    if (this.byId.delete(id)) this.entries = this.entries.filter((e) => e.id !== id);
  }

  private setEntries(list: IndexEntry[]): void {
    this.entries = list;
    this.byId = new Map(list.map((e) => [e.id, e]));
  }

  private async save(): Promise<void> {
    const tmp = `${INDEX_FILE}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(this.entries, null, 2)}\n`);
    await fsp.rename(tmp, INDEX_FILE);
  }
}

function isEntry(value: unknown): value is IndexEntry {
  return typeof value === 'object' && value !== null && typeof (value as IndexEntry).id === 'string' && typeof (value as IndexEntry).path === 'string';
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}
