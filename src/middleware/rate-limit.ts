import type { AuthenticatedRequest } from "@/types/common";
import { formatError } from "@/utils/error-formatter";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { log } from "../utils/logger";
import { RateLimitError } from "./error";
/**
 * Interface for rate limit entry
 */
interface RateLimitEntry {
	count: number;
	resetTime: number;
}

/**
 * Interface for rate limit store
 */
interface RateLimitStore {
	[key: string]: RateLimitEntry;
}

// In-memory store for rate limits
const stores: Record<string, RateLimitStore> = {};

/**
 * Maximum number of keys to store per limiter
 * This prevents memory leaks from malicious requests with random IPs/IDs
 */
const MAX_KEYS_PER_STORE = 10000;

/**
 * Clean up expired entries periodically
 */
const cleanupStores = (): void => {
	try {
		const now = Date.now();
		let totalCleanedEntries = 0;

		for (const storeName of Object.keys(stores)) {
			const store = stores[storeName];
			const storeKeyCount = Object.keys(store).length;
			let cleanedEntries = 0;

			for (const key of Object.keys(store)) {
				if (store[key].resetTime <= now) {
					delete store[key];
					cleanedEntries++;
				}
			}

			// If we have too many entries even after cleaning expired ones,
			// remove oldest entries to prevent memory issues
			if (storeKeyCount - cleanedEntries > MAX_KEYS_PER_STORE) {
				const entries = Object.entries(store).sort(
					(a, b) => a[1].resetTime - b[1].resetTime,
				);

				// Keep the newest MAX_KEYS_PER_STORE entries
				const entriesToRemove = entries.slice(
					0,
					entries.length - MAX_KEYS_PER_STORE,
				);
				for (const [key] of entriesToRemove) {
					delete store[key];
					cleanedEntries++;
				}

				log.warn("Rate limit store exceeded maximum size", {
					storeName,
					cleanedEntries: entriesToRemove.length,
				});
			}

			totalCleanedEntries += cleanedEntries;
		}

		if (totalCleanedEntries > 0) {
			log.debug("Rate limit cleanup completed", {
				cleanedEntries: totalCleanedEntries,
			});
		}
	} catch (error) {
		log.error("Error cleaning up rate limit stores", {
			error: formatError(error),
		});
	}
};

// Run cleanup every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(cleanupStores, CLEANUP_INTERVAL);

/**
 * Factory function to create rate limiter middleware
 * @param name The name of the rate limiter (used for storing limits)
 * @param maxRequests Maximum number of requests allowed in the time window
 * @param windowMs Time window in milliseconds
 * @returns Express middleware function
 */
export const createRateLimiter = (
	name: string,
	maxRequests: number,
	windowMs = config.rateLimit.windowMs,
) => {
	// Create store if it doesn't exist
	if (!stores[name]) {
		stores[name] = {};
	}

	const store = stores[name];

	return (req: Request, res: Response, next: NextFunction): void => {
		try {
			// Use user ID if available, otherwise IP address
			// Adding path component for more granular limiting
			const keyBase =
				(req as AuthenticatedRequest).userId || req.ip || "unknown";
			const key = `${keyBase}:${req.method}:${req.path}`;
			const now = Date.now();

			// Initialize or reset entry if it doesn't exist or has expired
			if (!store[key] || store[key].resetTime <= now) {
				store[key] = {
					count: 0,
					resetTime: now + windowMs,
				};
			}

			// Increment request count
			store[key].count += 1;

			// Calculate headers
			const currentCount = store[key].count;
			const remainingRequests = Math.max(0, maxRequests - currentCount);
			const resetTime = store[key].resetTime;
			const resetInSeconds = Math.ceil((resetTime - now) / 1000);

			// Set headers
			res.setHeader("RateLimit-Limit", maxRequests);
			res.setHeader("RateLimit-Remaining", remainingRequests);
			res.setHeader("RateLimit-Reset", Math.ceil(resetTime / 1000));

			// Check if rate limit is exceeded
			if (currentCount > maxRequests) {
				log.warn("Rate limit exceeded", {
					keyBase,
					method: req.method,
					path: req.path,
				});
				res.setHeader("Retry-After", resetInSeconds);

				// Throw a RateLimitError to be caught by the error handler middleware
				throw new RateLimitError(
					`Too many requests. Please try again in ${resetInSeconds} seconds.`,
				);
			}

			next();
		} catch (error) {
			// Pass to next error handler unless it's already a RateLimitError
			if (error instanceof RateLimitError) {
				next(error);
				return;
			}

			log.error("Error in rate limiter middleware", {
				error: formatError(error),
			});
			next(error);
		}
	};
};

// Create rate limiters for different routes
export const apiRateLimiter = createRateLimiter(
	"api",
	config.rateLimit.maxRequestsPerWindow.default,
);
export const authRateLimiter = createRateLimiter(
	"auth",
	config.rateLimit.maxRequestsPerWindow.auth,
);
export const conversationsRateLimiter = createRateLimiter(
	"conversations",
	config.rateLimit.maxRequestsPerWindow.conversations,
);
export const audioRateLimiter = createRateLimiter(
	"audio",
	config.rateLimit.maxRequestsPerWindow.audio,
);
export const subscriptionsRateLimiter = createRateLimiter(
	"subscriptions",
	config.rateLimit.maxRequestsPerWindow.subscriptions,
);
