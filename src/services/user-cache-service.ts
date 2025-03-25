import { logger } from '@/utils/logger';

interface CacheEntry {
  exists: boolean;
  timestamp: number;
}

class UserCacheService {
  private cache: Map<string, CacheEntry>;
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.cache = new Map();
    
    // Cleanup every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  set(userId: string, exists: boolean): void {
    this.cache.set(userId, {
      exists,
      timestamp: Date.now()
    });
  }

  get(userId: string): boolean | null {
    const entry = this.cache.get(userId);
    
    if (!entry) {
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(userId);
      return null;
    }

    return entry.exists;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.TTL_MS) {
        this.cache.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired user cache entries`);
    }
  }
}

// Export singleton instance
export const userCache = new UserCacheService(); 