import { query, run, transaction } from '@/database';
import type { Audio } from '@/types';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';


/**
 * Create a new audio record
 */
export const createAudioRecord = async ({
  conversationId,
  userId,
  audioFile,
  audioKey,
}: {
  conversationId: string;
  userId: string;
  audioFile: string;
  audioKey: string;
}): Promise<Audio> => {
  return await transaction(async () => {
    try {
      // First verify conversation exists and belongs to user
      const conversationExistsResult = await query<{ exists_flag: number }>(
        `SELECT 1 as exists_flag 
         FROM conversations 
         WHERE id = ? AND userId = ? 
         LIMIT 1`,
        [conversationId, userId]
      );
      
      const conversationExists = conversationExistsResult[0]?.exists_flag === 1;
      
      if (!conversationExists) {
        throw new Error(`Conversation ${conversationId} not found or does not belong to user ${userId}`);
      }
      
      const existingAudios = await query<{ count: number, recordingType: string, existingKey: number }>(
        `SELECT 
           COUNT(*) as count,
           c.recordingType,
           MAX(CASE WHEN a.audioKey = ? THEN 1 ELSE 0 END) as existingKey
         FROM conversations c
         LEFT JOIN audios a ON c.id = a.conversationId
         WHERE c.id = ?
         GROUP BY c.id`,
        [audioKey, conversationId]
      );

      const result = existingAudios[0];
      if (!result) {
        throw new Error(`Could not retrieve conversation details for limit check: ${conversationId}`);
      }

      const { count: audioCount, recordingType, existingKey } = result;

      if (existingKey === 1) {
        throw new Error(`Audio with key "${audioKey}" already exists for conversation ${conversationId}`);
      }

      const maxAudios = recordingType === 'separate' ? 2 : 1;
      if (audioCount >= maxAudios) {
        throw new Error(`Maximum number of audios (${maxAudios}) reached for conversation ${conversationId}`);
      }
      
      const audios = await query<Audio>(
        `INSERT INTO audios (conversationId, userId, audioFile, audioKey, status)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
        [conversationId, userId, audioFile, audioKey, 'uploaded']
      );
      
      const audio = audios[0];
      if (!audio) {
        throw new Error('Failed to create audio record');
      }
      
      return audio;
    } catch (error) {
      log.error(`Error creating audio record`, { conversationId, audioKey, error: formatError(error) });
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
    log.error(`Error fetching audio by ID`, { audioId, userId, error: formatError(error) });
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
    log.error(`Error fetching conversation audios`, { conversationId, error: formatError(error) });
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
      const audioExistsResult = await query<{ exists_flag: number }>(
        'SELECT 1 as exists_flag FROM audios WHERE id = ? LIMIT 1',
        [audioId]
      );
      
      const audioExists = audioExistsResult[0]?.exists_flag === 1;
      
      if (!audioExists) {
        log.warn(`Attempted to update status for non-existent audio ID: ${audioId}`);
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
      log.debug("Audio status updated", { audioId, status });
    } catch (error) {
      log.error(`Error updating audio status`, { audioId, status, error: formatError(error) });
      throw error;
    }
  });
};

// Get audio by file path
export const getAudioByPath = async (filePath: string): Promise<Audio | null> => {
  try {
    const audios = await query<Audio>(
      `SELECT * FROM audios WHERE audioFile = ?`,
      [filePath]
    );
    return audios[0] || null;
  } catch (error) {
    log.error(`Failed to get audio by path`, { filePath, error: formatError(error) });
    throw error;
  }
};