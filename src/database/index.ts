import { logger } from '@/utils';
import { type Database } from 'bun:sqlite';
import { ConnectionPool } from './connection-pool';

// Initialize connection pool with default options
const pool = new ConnectionPool();

// Export database operations
export const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
  return pool.query<T>(sql, params);
};

export const queryOne = async <T>(sql: string, params: unknown[] = []): Promise<T | null> => {
  return pool.queryOne<T>(sql, params);
};

export const run = async (sql: string, params: unknown[] = []): Promise<void> => {
  return pool.run(sql, params);
};

export const transaction = async <T>(callback: (db: Database) => Promise<T>): Promise<T> => {
  return pool.transaction(callback);
};

// Setup cleanup interval
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  pool.cleanup();
}, CLEANUP_INTERVAL);

// Export pool for direct access if needed
export { pool };

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Closing database connections...');
  pool.close();
});

process.on('SIGINT', () => {
  logger.info('Closing database connections...');
  pool.close();
});