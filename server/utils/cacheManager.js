// Cache clearing utilities for performance optimization
const NodeCache = require("node-cache");

// Import caches from controllers (we'll need to modify this approach)
// For now, we'll create a simple cache manager

class CacheManager {
  constructor() {
    this.caches = new Map();
  }

  register(cacheName, cacheInstance) {
    this.caches.set(cacheName, cacheInstance);
  }

  clearUserCache(userId, cacheType = "all") {
    console.log(`Clearing cache for user ${userId}, type: ${cacheType}`);

    if (cacheType === "all" || cacheType === "orders") {
      const orderCache = this.caches.get("orders");
      if (orderCache) {
        orderCache.del(`orders_${userId}`);
      }
    }

    if (cacheType === "all" || cacheType === "cart") {
      const cartCache = this.caches.get("cart");
      if (cartCache) {
        cartCache.del(`cart_${userId}`);
      }
    }
  }

  clearAllCache() {
    console.log("Clearing all caches");
    this.caches.forEach((cache, name) => {
      cache.flushAll();
      console.log(`Cleared ${name} cache`);
    });
  }
}

const cacheManager = new CacheManager();

module.exports = cacheManager;
