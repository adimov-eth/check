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
      
      // Get user or create if doesn't exist from Clerk
      // If this is being called, we've already passed auth middleware,
      // so we know the user exists in Clerk
      const userExistsResult = await query<{ exists_flag: number }>(
        'SELECT 1 as exists_flag FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      
      const userExists = userExistsResult[0]?.exists_flag === 1;
      
      if (!userExists) {
        // Create a basic user record with the information we have
        try {
          logger.warn(`User ${userId} not found in database but exists in Clerk auth. Creating minimal record.`);
          
          // Since email is required, let's use a temporary one based on userId
          // Later the Clerk webhook or auth middleware will update with the real email
          const tempEmail = `${userId}@temporary.vibecheck.app`;
          
          await run(
            'INSERT INTO users (id, email) VALUES (?, ?)',
            [userId, tempEmail]
          );
          
          logger.info(`Created minimal user record for ${userId} with temporary email`);
        } catch (error) {
          logger.error(`Failed to create user record: ${error instanceof Error ? error.message : String(error)}`);
          throw new Error(`Failed to create user record for ${userId}`);
        }
      }
      
      const conversations = await query<Conversation>(
        `INSERT INTO conversations (id, userId, mode, recordingType, status)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
        [id, userId, mode, recordingType, 'waiting']
      );
      
      const conversation = conversations[0];
      if (!conversation) {
        throw new Error('Failed to create conversation');
      }
      
      logger.info(`Created conversation ${id} for user ${userId}`);
      return conversation;
    } catch (error) {
      logger.error(`Error creating conversation: ${error instanceof Error ? error.message : String(error)}`);
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