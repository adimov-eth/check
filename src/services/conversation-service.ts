import { randomUUIDv7 } from "bun";

import { query, run, transaction } from '@/database';
import type { Conversation } from '@/types';
import { logger } from '@/utils/logger';

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
        logger.error(`User ${userId} not found in database but passed auth middleware`);
        throw new Error(`User not found: ${userId}`);
      }
      
      // Create the conversation
      await run(
        'INSERT INTO conversations (id, userId, mode, recordingType, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, userId, mode, recordingType, 'waiting', now, now]
      );
      
      logger.info(`Created conversation ${id} for user ${userId}`);
      
      return {
        id,
        userId,
        mode,
        recordingType,
        status: 'waiting',
        createdAt: now,
        updatedAt: now
      };
    } catch (error) {
      logger.error(`Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
};

/**
 * Get conversation by ID
 */
export const getConversationById = async (conversationId: string, userId: string): Promise<Conversation | null> => {
  try {
    const conversations = await query<Conversation>(
      `SELECT * FROM conversations WHERE id = ? AND userId = ?`,
      [conversationId, userId]
    );
    
    return conversations[0] || null;
  } catch (error) {
    logger.error(`Error fetching conversation by ID: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Get all conversations for a user
 */
export const getUserConversations = async (userId: string): Promise<Conversation[]> => {
  try {
    return await query<Conversation>(
      `SELECT * FROM conversations WHERE userId = ? ORDER BY createdAt DESC`,
      [userId]
    );
  } catch (error) {
    logger.error(`Error fetching user conversations: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Update conversation status
 */
export const updateConversationStatus = async (
  conversationId: string, 
  status: string,
  gptResponse?: string,
  errorMessage?: string
): Promise<void> => {
  try {
    const updateFields = ['status = ?', 'updatedAt = strftime(\'%s\', \'now\')'];
    const params: unknown[] = [status];
    
    if (gptResponse !== undefined) {
      updateFields.push('gptResponse = ?');
      params.push(gptResponse);
    }
    
    if (errorMessage !== undefined) {
      updateFields.push('errorMessage = ?');
      params.push(errorMessage);
    }
    
    params.push(conversationId);
    
    await run(
      `UPDATE conversations 
       SET ${updateFields.join(', ')}
       WHERE id = ?`,
      params
    );
    
    logger.info(`Updated conversation ${conversationId} status to ${status}`);
  } catch (error) {
    logger.error(`Error updating conversation status: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};