/** Generic self-registering plugin registry. Duplicate ids are rejected. */
export class PluginRegistry<T extends { readonly id: string }> {
  private readonly plugins = new Map<string, T>();

  register(plugin: T): this {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin already registered: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
    return this;
  }

  get(id: string): T | undefined {
    return this.plugins.get(id);
  }

  list(): T[] {
    return [...this.plugins.values()];
  }
}
