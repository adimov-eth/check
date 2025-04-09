import { logger } from '@/utils';
import { formatError } from '@/utils/error-formatter';
import { Database, type Database as BunDatabase, type SQLQueryBindings } from 'bun:sqlite';

// Initialize a single, persistent database instance
const initializeDatabase = (): BunDatabase => {
  const db = new Database('app.db', { create: true });
  logger.info('Database connection established.');

  // Apply optimizations directly to the single instance
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;'); // Set a busy timeout
    // Bun:sqlite manages cache size automatically, so cache_size pragma might not be needed/effective.
    // db.exec('PRAGMA cache_size = -64000;'); // Optional: Bun might handle this better automatically
    db.exec('PRAGMA temp_store = MEMORY;');
    logger.info('Applied database PRAGMA optimizations.');
  } catch (error) {
      logger.error(`Error applying PRAGMA settings: ${formatError(error)}`);
      // Decide if this is fatal or not. For now, log and continue.
  }

  return db;
};

const dbInstance = initializeDatabase();

// Export database operations operating on the single instance
export const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
  try {
    // Use `query` method for SELECT statements, ensuring parameters are correctly bound
    const stmt = dbInstance.query<T, SQLQueryBindings[]>(sql);
    return stmt.all(...params as SQLQueryBindings[]);
  } catch (error) {
    logger.error(`Database query error: ${formatError(error)} - SQL: ${sql}`);
    throw error; // Re-throw to allow calling functions to handle
  }
};

export const queryOne = async <T>(sql: string, params: unknown[] = []): Promise<T | null> => {
   try {
    // Use `query` method for SELECT statements
    const stmt = dbInstance.query<T, SQLQueryBindings[]>(sql);
    const result = stmt.get(...params as SQLQueryBindings[]);
    return result === undefined ? null : result;
  } catch (error) {
    logger.error(`Database queryOne error: ${formatError(error)} - SQL: ${sql}`);
    throw error;
  }
};

export const run = async (sql: string, params: unknown[] = []): Promise<void> => {
  try {
    // Use `run` for INSERT, UPDATE, DELETE where results aren't the primary concern
    const stmt = dbInstance.prepare(sql);
    stmt.run(...params as SQLQueryBindings[]);
  } catch (error) {
    logger.error(`Database run error: ${formatError(error)} - SQL: ${sql}`);
    throw error;
  }
};

// Use Bun's built-in transaction helper for simplicity and correctness
export const transaction = async <T>(callback: (db: BunDatabase) => Promise<T> | T): Promise<T> => {
  try {
    // Bun's transaction method handles BEGIN, COMMIT, ROLLBACK automatically
    const tx = dbInstance.transaction(callback);
    // Execute the transaction function provided by Bun SQLite
    return await tx();
  } catch (error) {
    logger.error(`Database transaction error: ${formatError(error)}`);
    throw error;
  }
};

// Graceful shutdown - close the single instance
const closeDatabase = (): void => {
  try {
    dbInstance.close();
    logger.info('Database connection closed.');
  } catch (error) {
    logger.error(`Error closing database connection: ${formatError(error)}`);
  }
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Closing database connection...');
  closeDatabase();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Closing database connection...');
  closeDatabase();
});

// Export the db instance directly if needed elsewhere (e.g., migrations)
// Note: Direct use should be limited. Prefer the exported functions.
export { dbInstance };
