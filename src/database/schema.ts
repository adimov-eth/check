import { logger } from '@/utils';
import { pool } from './index';

export const initSchema = async (): Promise<void> => {
  await pool.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  await pool.run(`
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
    CREATE INDEX IF NOT EXISTS idx_conversations_userId ON conversations(userId);
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
  `);

  await pool.run(`
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
    CREATE INDEX IF NOT EXISTS idx_audios_conversationId ON audios(conversationId);
    CREATE INDEX IF NOT EXISTS idx_audios_userId ON audios(userId);
    CREATE INDEX IF NOT EXISTS idx_audios_status ON audios(status);
  `);

  await pool.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      originalTransactionId TEXT NOT NULL,
      transactionId TEXT NOT NULL,
      receiptData TEXT NOT NULL,
      environment TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 0,
      expiresDate INTEGER,
      purchaseDate INTEGER NOT NULL,
      lastVerifiedDate INTEGER NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_userId ON subscriptions(userId);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_isActive ON subscriptions(isActive);
  `);
  
  logger.info('Database schema initialized');
};