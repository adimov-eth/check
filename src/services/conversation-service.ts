// src/services/conversation-service.ts
import { randomUUIDv7 } from "bun";

import { query, run, transaction } from '@/database';
import type { Conversation } from '@/types'; // Ensure Conversation includes userId
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';

/**
 * Create a new conversation
 */
export const createConversation = async ({
  userId,
  mode,
  recordingType,
}: {
  userId: string;
  mode: string;
  recordingType: 'separate' | 'live';
}): Promise<Conversation> => {
  return await transaction(async () => {
    try {
      const id = randomUUIDv7();
      const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

      // Get user or create if doesn't exist
      // If this is being called, we've already passed auth middleware,
      // so we know the user exists in our auth system
      const userExistsResult = await query<{ exists_flag: number }>(
        'SELECT 1 as exists_flag FROM users WHERE id = ? LIMIT 1',
        [userId]
      );

      const userExists = userExistsResult[0]?.exists_flag === 1;

      if (!userExists) {
        // This shouldn't happen with proper middleware
        log.error(`User not found in database but passed auth middleware`, { userId });
        throw new Error(`User not found: ${userId}`);
      }

      // Create the conversation
      await run(
        'INSERT INTO conversations (id, userId, mode, recordingType, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, userId, mode, recordingType, 'waiting', now, now]
        // Note: gptResponse and errorMessage default to NULL in the DB schema presumably
      );

      log.info(`Created conversation`, { conversationId: id, userId });

      // Ensure the returned object matches the Conversation type
      return {
        id,
        userId,
        mode,
        recordingType,
        status: 'waiting',
        createdAt: now,
        updatedAt: now,
        // --- FIX: Use undefined instead of null ---
        gptResponse: undefined,
        errorMessage: undefined,
        // --- End Fix ---
      };
    } catch (error) {
      log.error(`Failed to create conversation`, { error: formatError(error) });
      throw error;
    }
  });
};

/**
 * Get conversation by ID (without user filter - ownership checked by middleware)
 */
export const getConversationById = async (conversationId: string): Promise<Conversation | null> => {
  try {
    const conversations = await query<Conversation>(
      `SELECT * FROM conversations WHERE id = ?`,
      [conversationId]
    );
    // Ensure DB NULL values are mapped to undefined if necessary by the query function or here
    const result = conversations[0] || null;
    if (result) {
        // Explicitly map potential nulls from DB to undefined if query doesn't handle it
        result.gptResponse = result.gptResponse ?? undefined;
        result.errorMessage = result.errorMessage ?? undefined;
    }
    return result;
  } catch (error) {
    log.error(`Error fetching conversation by ID`, { conversationId, error: formatError(error) });
    throw error;
  }
};

/**
 * Get all conversations for a user
 */
export const getUserConversations = async (userId: string): Promise<Conversation[]> => {
  try {
    const conversations = await query<Conversation>(
      `SELECT * FROM conversations WHERE userId = ? ORDER BY createdAt DESC`,
      [userId]
    );
    // Ensure DB NULL values are mapped to undefined if necessary
    return conversations.map(conv => ({
        ...conv,
        gptResponse: conv.gptResponse ?? undefined,
        errorMessage: conv.errorMessage ?? undefined,
    }));
  } catch (error) {
    log.error(`Error fetching user conversations`, { userId, error: formatError(error) });
    throw error;
  }
};

/**
 * Update conversation status
 */
export const updateConversationStatus = async (
  conversationId: string,
  status: string, // Consider using a specific status type: 'waiting' | 'processing' | 'completed' | 'error'
  gptResponse?: string | null, // Allow null from callers, will be stored as NULL in DB
  errorMessage?: string | null // Allow null from callers, will be stored as NULL in DB
): Promise<void> => {
  try {
    // Use strftime('%s', 'now') for SQLite timestamp in seconds
    const updateFields = ['status = ?', 'updatedAt = strftime(\'%s\', \'now\')'];
    // Pass null directly to DB if gptResponse/errorMessage is undefined or null
    const params: unknown[] = [status];

    if (gptResponse !== undefined) {
      updateFields.push('gptResponse = ?');
      params.push(gptResponse); // Pass null or string
    }

    if (errorMessage !== undefined) {
      updateFields.push('errorMessage = ?');
      params.push(errorMessage); // Pass null or string
    }

    params.push(conversationId);

    await run(
      `UPDATE conversations
       SET ${updateFields.join(', ')}
       WHERE id = ?`,
      params
    );

    log.info(`Updated conversation status`, { conversationId, status });
  } catch (error) {
    log.error(`Error updating conversation status`, { conversationId, status, error: formatError(error) });
    throw error;
  }
};