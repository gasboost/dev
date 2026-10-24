import { InMemoryCache } from "./InMemoryCache";

export type InMemoryCacheServiceOptions = {
  document?: Record<string, string>;
  user?: Record<string, string>;
  script?: Record<string, string>;
};

export class InMemoryCacheService
  implements GoogleAppsScript.Cache.CacheService
{
  private readonly documentCache = new InMemoryCache();
  private readonly userCache = new InMemoryCache();
  private readonly scriptCache = new InMemoryCache();

  constructor(options: InMemoryCacheServiceOptions = {}) {
    this.documentCache.putAll(options.document ?? {});
    this.userCache.putAll(options.user ?? {});
    this.scriptCache.putAll(options.script ?? {});
  }

  getDocumentCache(): InMemoryCache | null {
    return this.documentCache;
  }
  getUserCache(): InMemoryCache {
    return this.userCache;
  }
  getScriptCache(): InMemoryCache {
    return this.scriptCache;
  }
}
