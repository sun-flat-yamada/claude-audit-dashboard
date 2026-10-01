/** Ordered, duplicate-rejecting registry. Every extension point is registered through one. */
export class Registry<T> {
  private readonly items = new Map<string, T>();

  constructor(
    private readonly keyOf: (item: T) => string,
    private readonly kind = 'item',
  ) {}

  add(item: T): this {
    const key = this.keyOf(item);
    if (this.items.has(key)) throw new Error(`Duplicate ${this.kind}: ${key}`);
    this.items.set(key, item);
    return this;
  }

  addAll(items: Iterable<T>): this {
    for (const item of items) this.add(item);
    return this;
  }

  get(key: string): T | undefined {
    return this.items.get(key);
  }

  require(key: string): T {
    const item = this.items.get(key);
    if (item === undefined) {
      throw new Error(`Unknown ${this.kind}: ${key} (available: ${this.keys().join(', ')})`);
    }
    return item;
  }

  keys(): string[] {
    return [...this.items.keys()];
  }

  list(): T[] {
    return [...this.items.values()];
  }
}
