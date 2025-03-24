import { query, run, transaction } from '@/database';
import type { Audio } from '@/types';
import { logger } from '@/utils/logger';


/**
 * Create a new audio record
 */
export const createAudioRecord = async ({
  conversationId,
  userId,
  audioFile,
}: {
  conversationId: string;
  userId: string;
  audioFile: string;
}): Promise<Audio> => {
  return await transaction(async () => {
    try {
      // First verify conversation exists and belongs to user
      const conversationExistsResult = await query<{ exists: number }>(
        `SELECT 1 as exists 
         FROM conversations 
         WHERE id = ? AND userId = ? 
         LIMIT 1`,
        [conversationId, userId]
      );
      
      const conversationExists = conversationExistsResult[0]?.exists === 1;
      
      if (!conversationExists) {
        throw new Error(`Conversation ${conversationId} not found or does not belong to user ${userId}`);
      }
      
      // Check if we've reached the audio limit for this conversation
      const audioCountResult = await query<{ count: number }>(
        'SELECT COUNT(*) as count FROM audios WHERE conversationId = ?',
        [conversationId]
      );
      
      const audioCount = audioCountResult[0].count;
      
      const conversationResult = await query<{ recordingType: string }>(
        'SELECT recordingType FROM conversations WHERE id = ?',
        [conversationId]
      );
      
      const conversation = conversationResult[0];
      
      const maxAudios = conversation.recordingType === 'separate' ? 2 : 1;
      if (audioCount >= maxAudios) {
        throw new Error(`Maximum number of audios (${maxAudios}) reached for conversation ${conversationId}`);
      }
      
      const audios = await query<Audio>(
        `INSERT INTO audios (conversationId, userId, audioFile, status)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
        [conversationId, userId, audioFile, 'uploaded']
      );
      
      const audio = audios[0];
      if (!audio) {
        throw new Error('Failed to create audio record');
      }
      
      return audio;
    } catch (error) {
      logger.error(`Error creating audio record: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
};

/**
 * Get audio by ID
 */
export const getAudioById = async (audioId: number, userId: string): Promise<Audio | null> => {
  try {
    const audios = await query<Audio>(
      `SELECT * FROM audios WHERE id = ? AND userId = ?`,
      [audioId, userId]
    );
    
    return audios[0] || null;
  } catch (error) {
    logger.error(`Error fetching audio by ID: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Get all audio records for a conversation
 */
export const getConversationAudios = async (conversationId: string): Promise<Audio[]> => {
  try {
    return await query<Audio>(
      `SELECT * FROM audios WHERE conversationId = ? ORDER BY createdAt ASC`,
      [conversationId]
    );
  } catch (error) {
    logger.error(`Error fetching conversation audios: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Update audio status
 */
export const updateAudioStatus = async (
  audioId: number, 
  status: string,
  transcription?: string,
  errorMessage?: string
): Promise<void> => {
  await transaction(async () => {
    try {
      // First verify audio exists
      const audioExistsResult = await query<{ exists: number }>(
        'SELECT 1 as exists FROM audios WHERE id = ? LIMIT 1',
        [audioId]
      );
      
      const audioExists = audioExistsResult[0]?.exists === 1;
      
      if (!audioExists) {
        throw new Error(`Audio ${audioId} not found`);
      }
      
      const updateFields = ['status = ?', 'updatedAt = strftime(\'%s\', \'now\')'];
      const params: unknown[] = [status];
      
      if (transcription !== undefined) {
        updateFields.push('transcription = ?');
        params.push(transcription);
      }
      
      if (errorMessage !== undefined) {
        updateFields.push('errorMessage = ?');
        params.push(errorMessage);
      }
      
      if (status === 'transcribed') {
        updateFields.push('audioFile = NULL');
      }
      
      params.push(audioId);
      
      await run(
        `UPDATE audios 
         SET ${updateFields.join(', ')}
         WHERE id = ?`,
        params
      );
    } catch (error) {
      logger.error(`Error updating audio status: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
};

// Get audio by file path
export const getAudioByPath = async (filePath: string): Promise<Audio | null> => {
  try {
    return await transaction(async () => {
      const audios = await query<Audio>(
        `SELECT * FROM audios WHERE audioFile = ?`,
        [filePath]
      );
      return audios[0] || null;
    });
  } catch (error) {
    logger.error(`Failed to get audio by path: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};