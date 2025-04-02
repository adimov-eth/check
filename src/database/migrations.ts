// server/src/database/migrations.ts (New File)
import { logger } from '@/utils';
import { pool } from './index';

const TARGET_SCHEMA_VERSION = 2; // Increment this for future migrations

export const runMigrations = async (): Promise<void> => {
  try {
    // Get current schema version
    const result = await pool.queryOne<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = result?.user_version ?? 0;

    logger.info(`Current database schema version: ${currentVersion}. Target version: ${TARGET_SCHEMA_VERSION}`);

    if (currentVersion >= TARGET_SCHEMA_VERSION) {
      logger.info('Database schema is up to date.');
      return;
    }

    // --- Migration Logic ---
    if (currentVersion < 1) {
      // Migration from v0 to v1 (Initial schema creation - handled by schema.ts)
      // We assume schema.ts already ran if currentVersion is 0, but it's good practice
      // to potentially include initial schema setup here if needed in a pure migration system.
      // For now, we'll just update the version.
      await pool.run(`PRAGMA user_version = 1`);
      logger.info('Set database schema version to 1.');
    }

    if (currentVersion < 2) {
      // Migration from v1 to v2 (Update subscriptions table)
      logger.info('Running migration: Update subscriptions table schema (v1 -> v2)...');
      await pool.transaction(async (db) => {
        // 1. Create the new table structure
        await db.exec(`
          CREATE TABLE subscriptions_new (
            id TEXT PRIMARY KEY, -- Use originalTransactionId as primary key
            userId TEXT NOT NULL,
            originalTransactionId TEXT NOT NULL UNIQUE, -- Ensure unique
            productId TEXT NOT NULL,
            status TEXT NOT NULL, -- Added status column
            environment TEXT NOT NULL,
            expiresDate INTEGER, -- Nullable timestamp in seconds
            purchaseDate INTEGER NOT NULL, -- Timestamp in seconds
            lastTransactionId TEXT NOT NULL, -- Added
            lastTransactionInfo TEXT, -- Added, nullable JSON string
            lastRenewalInfo TEXT, -- Added, nullable JSON string
            appAccountToken TEXT, -- Added, nullable
            subscriptionGroupIdentifier TEXT, -- Added, nullable
            offerType INTEGER, -- Added, nullable
            offerIdentifier TEXT, -- Added, nullable
            createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
          );
        `);

        // 2. Copy data from old table to new, transforming as needed
        // Determine current time in seconds for status calculation
        const nowSeconds = Math.floor(Date.now() / 1000);
        await db.exec(`
          INSERT INTO subscriptions_new (
            id, userId, originalTransactionId, productId, status, environment,
            expiresDate, purchaseDate, lastTransactionId, lastTransactionInfo,
            createdAt, updatedAt
            -- lastRenewalInfo, appAccountToken, subscriptionGroupIdentifier, offerType, offerIdentifier default to NULL
          )
          SELECT
            originalTransactionId, -- Use originalTransactionId for the new primary key 'id'
            userId,
            originalTransactionId,
            productId,
            -- Calculate status based on old isActive and expiresDate (best guess)
            CASE
              WHEN isActive = 1 AND (expiresDate IS NULL OR expiresDate > ${nowSeconds}) THEN 'active'
              ELSE 'expired' -- Default to 'expired' if not clearly active
            END,
            environment,
            expiresDate,
            purchaseDate,
            transactionId, -- Map old transactionId to lastTransactionId
            receiptData,   -- Map old receiptData to lastTransactionInfo (approximation)
            createdAt,
            updatedAt        -- Preserve original timestamps
          FROM subscriptions;
        `);

        // 3. Drop the old table
        await db.exec('DROP TABLE subscriptions;');

        // 4. Rename the new table
        await db.exec('ALTER TABLE subscriptions_new RENAME TO subscriptions;');

        // 5. Recreate indexes (ensure names match schema.ts if re-runnable)
        await db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_userId ON subscriptions(userId);');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_expiresDate ON subscriptions(expiresDate);');

        // 6. Update schema version *within the transaction*
        await db.exec(`PRAGMA user_version = ${TARGET_SCHEMA_VERSION}`);

      });
      logger.info(`Successfully migrated subscriptions table to v2 and set schema version to ${TARGET_SCHEMA_VERSION}.`);
    }

    // Add future migrations here using `if (currentVersion < NEW_VERSION) { ... }`

  } catch (error) {
    logger.error(`Database migration failed: ${error instanceof Error ? error.message : String(error)}`);
    // Depending on the error, you might want to exit the process
    // process.exit(1);
    throw error; // Re-throw to indicate failure
  }
};