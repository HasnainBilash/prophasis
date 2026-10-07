/**
 * A small least-recently-used cache. A Map keeps insertion order, so the first
 * key is always the oldest; reading an entry moves it to the end.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
