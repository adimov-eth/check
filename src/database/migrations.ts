// server/src/database/migrations.ts (New File)
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
import { type Database, type SQLQueryBindings } from 'bun:sqlite'; // Import Database type and SQLQueryBindings
import { dbInstance } from './index'; // Import the direct instance

const TARGET_SCHEMA_VERSION = 2; // Increment this for future migrations

export const runMigrations = async (): Promise<void> => {
  try {
    // Get current schema version using the dbInstance
    // Specify both result type and parameter type for query
    const result = dbInstance.query<{ user_version: number }, SQLQueryBindings[]>
      ('PRAGMA user_version').get();
    const currentVersion = result?.user_version ?? 0;

    log.info(`Current database schema version`, { currentVersion, targetVersion: TARGET_SCHEMA_VERSION });

    if (currentVersion >= TARGET_SCHEMA_VERSION) {
      log.info('Database schema is up to date.');
      return;
    }

    // Get a transaction function for migrations
    // Define the callback type explicitly
    type MigrationCallback = (txDb: Database) => Promise<void> | void;
    const runTransaction = dbInstance.transaction((migrationCallback: MigrationCallback) => {
        // The callback receives the database instance, which is already typed by Bun's transaction
        // No need to cast dbInstance here, the callback parameter is what matters.
        return migrationCallback(dbInstance); 
    });

    // --- Migration Logic ---
    if (currentVersion < 1) {
      log.info('Running migration: Initialize schema (v0 -> v1)...');
      // Explicitly type the db parameter in the callback
      await runTransaction(async (db: Database) => { 
          // Initial Schema Creation (from schema.ts)
          await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE, -- Added UNIQUE constraint
              name TEXT,
              appAccountToken TEXT UNIQUE, -- Added for Apple Sign In mapping
              createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
          `);
          await db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);');
          await db.exec('CREATE INDEX IF NOT EXISTS idx_users_appAccountToken ON users(appAccountToken);'); // Index for token lookup


          await db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              userId TEXT NOT NULL,
              mode TEXT NOT NULL,
              recordingType TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'waiting',
              gptResponse TEXT,
              errorMessage TEXT,
              createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            );
          `);
          await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_userId ON conversations(userId);');
          await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);');


          await db.exec(`
            CREATE TABLE IF NOT EXISTS audios (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              conversationId TEXT NOT NULL,
              userId TEXT NOT NULL,
              audioFile TEXT,
              transcription TEXT,
              status TEXT NOT NULL DEFAULT 'uploaded',
              errorMessage TEXT,
              createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
              FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            );
          `);
          await db.exec('CREATE INDEX IF NOT EXISTS idx_audios_conversationId ON audios(conversationId);');
          await db.exec('CREATE INDEX IF NOT EXISTS idx_audios_userId ON audios(userId);');
          await db.exec('CREATE INDEX IF NOT EXISTS idx_audios_status ON audios(status);');

          // IMPORTANT: Update schema version *within the transaction*
          await db.exec(`PRAGMA user_version = 1`);
      });
       log.info('Successfully initialized schema and set version to 1.');
    }

    if (currentVersion < 2) {
      // Migration from v1 to v2 (Update subscriptions table)
      log.info('Running migration: Update subscriptions table schema (v1 -> v2)...');
      // Explicitly type the db parameter in the callback
      await runTransaction(async (db: Database) => { 
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
              appAccountToken TEXT, -- Added, nullable (Link to user table)
              subscriptionGroupIdentifier TEXT, -- Added, nullable
              offerType INTEGER, -- Added, nullable
              offerIdentifier TEXT, -- Added, nullable
              createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
              FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            );
          `);

          // 2. Copy data (if `subscriptions` table exists from a previous schema/migration)
          // Check if old table exists before attempting insert
          // Specify result type and param type for query
          const oldTableExists = db.query<{ name: string }, []>(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions';`
          ).get();

          if (oldTableExists) {
              const nowSeconds = Math.floor(Date.now() / 1000);
              await db.exec(`
              INSERT INTO subscriptions_new (
                  id, userId, originalTransactionId, productId, status, environment,
                  expiresDate, purchaseDate, lastTransactionId, lastTransactionInfo,
                  createdAt, updatedAt
                  -- appAccountToken, lastRenewalInfo, subscriptionGroupIdentifier, offerType, offerIdentifier default to NULL
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

              // 3. Drop the old table only if it existed
              await db.exec('DROP TABLE subscriptions;');
          } else {
              log.info('Old `subscriptions` table not found, skipping data migration and drop for v2.');
          }

          // 4. Rename the new table
          await db.exec('ALTER TABLE subscriptions_new RENAME TO subscriptions;');

          // 5. Recreate indexes
          await db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_userId ON subscriptions(userId);');
          await db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);');
          await db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_expiresDate ON subscriptions(expiresDate);');
          await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_originalTransactionId ON subscriptions(originalTransactionId);'); // Ensure uniqueness

          // 6. Update schema version *within the transaction*
          await db.exec(`PRAGMA user_version = ${TARGET_SCHEMA_VERSION}`);
      });
      log.info(`Successfully migrated subscriptions table to v2`, { schemaVersion: TARGET_SCHEMA_VERSION });
    }

    // Add future migrations here using `if (currentVersion < NEW_VERSION) { ... }`

  } catch (error) {
    log.error(`Database migration failed`, { error: formatError(error) });
    throw error; // Re-throw to indicate failure
  }
};