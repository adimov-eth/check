import { config } from '@/config';
import { query, queryOne, transaction } from '@/database';
import { ExternalServiceError } from '@/middleware/error';
import { sendConversationNotification, sendStatusNotification } from '@/services/notification-service';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import { generateGptResponse } from '@/utils/openai';
import { SYSTEM_PROMPTS } from '@/utils/system-prompts';
import { sanitizeInput } from '@/utils/validation';
import { Job, Worker, type ConnectionOptions } from 'bullmq';

import type { Audio, Conversation } from '@/types';

/**
 * Create a prompt for GPT based on conversation mode and recording type
 * @param mode Conversation mode (maps to a system prompt)
 * @param recordingType Type of recording (separate or live)
 * @param transcriptions Array of transcriptions
 * @returns Formatted prompt for GPT
 */
const createPrompt = (
  mode: string,
  recordingType: string,
  transcriptions: string[]
): string => {
  // Get system prompt for the selected mode
  const systemPrompt = SYSTEM_PROMPTS[mode as keyof typeof SYSTEM_PROMPTS];
  if (!systemPrompt) {
    throw new Error(`Invalid conversation mode: ${mode}`);
  }
  
  // Sanitize transcriptions to prevent prompt injection
  const sanitizedTranscriptions = transcriptions.map(text => sanitizeInput(text));
  
  // Format prompt based on recording type
  return recordingType === 'separate'
    ? `${systemPrompt}\n\nPartner 1: ${sanitizedTranscriptions[0]}\nPartner 2: ${sanitizedTranscriptions[1]}`
    : `${systemPrompt}\n\nConversation: ${sanitizedTranscriptions[0]}`;
};

/**
 * Queue connection configuration with retry logic
 */
const queueConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  connectTimeout: 10000,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 1000, 10000);
    logger.info(`Redis connection retry ${times} in ${delay}ms`);
    return delay;
  }
};

/**
 * Worker for processing GPT requests
 */
const worker = new Worker(
  'gptProcessing',
  async (job: Job) => {
    const { conversationId, userId } = job.data;
    
    logger.info(`Processing GPT job ${job.id} for conversation ${conversationId}`);
    
    try {
      // Notify processing started
      await sendStatusNotification(userId, conversationId, 'processing');

      // Fetch conversation
      const conversation = await queryOne<Conversation>(
        'SELECT * FROM conversations WHERE id = ? AND userId = ?',
        [conversationId, userId]
      );
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found or does not belong to user ${userId}`);
      }

      // Fetch audios
      const conversationAudios = await query<Audio>(
        'SELECT * FROM audios WHERE conversationId = ? ORDER BY createdAt ASC',
        [conversationId]
      );

      const transcriptions = conversationAudios
        .map(audio => audio.transcription)
        .filter((t): t is string => t !== null && t !== undefined && t.trim().length > 0);
      
      // Check if we have transcriptions
      if (transcriptions.length === 0) {
        throw new Error('No valid transcriptions found for this conversation');
      }

      // Validate audio count based on recording type
      if (conversation.recordingType === 'separate' && transcriptions.length !== 2) {
        throw new Error(`Expected two transcriptions for separate mode, but found ${transcriptions.length}`);
      }
      if (conversation.recordingType === 'live' && transcriptions.length !== 1) {
        throw new Error(`Expected one transcription for live mode, but found ${transcriptions.length}`);
      }

      // Generate GPT response
      const prompt = createPrompt(conversation.mode, conversation.recordingType, transcriptions);
      const result = await generateGptResponse(prompt);

      if (!result.success) {
        throw result.error;
      }

      // Update conversation with response within a transaction
      await transaction(async () => {
        await query(
          `UPDATE conversations 
           SET gptResponse = ?, 
               status = ?, 
               updatedAt = strftime('%s', 'now') 
           WHERE id = ?`,
          [result.data, 'completed', conversationId]
        );
      });

      // Send completion notifications
      await Promise.all([
        sendStatusNotification(userId, conversationId, 'completed'),
        sendConversationNotification(userId, conversationId, 'conversation_completed', { 
          gptResponse: result.data 
        })
      ]);
      
      logger.info(`Successfully processed conversation ${conversationId}`);
      return { success: true };
    } catch (error) {
      // Handle specific errors
      if (error instanceof ExternalServiceError) {
        logger.error(`External service error processing conversation ${conversationId}: ${error.message}`);
      } else {
        logger.error(`GPT processing failed for job ${job.id}: ${formatError(error)}`);
      }
      
      // Determine appropriate error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Update conversation status to failed
      try {
        await query(
          `UPDATE conversations 
           SET status = ?, 
               errorMessage = ?, 
               updatedAt = strftime('%s', 'now') 
           WHERE id = ?`,
          ['failed', errorMessage, conversationId]
        );
        
        // Send error notification
        await sendStatusNotification(userId, conversationId, 'error', errorMessage);
      } catch (notificationError) {
        logger.error(`Failed to send error notification: ${formatError(notificationError)}`);
      }
      
      // Rethrow to mark job as failed
      throw error;
    }
  },
  { 
    connection: queueConnection,
    concurrency: 3
  }
);

// Event listeners for logging
worker.on('completed', (job: Job) => logger.info(`GPT job ${job.id} completed successfully`));
worker.on('failed', (job: Job | undefined, err: Error) => 
  logger.error(`GPT job ${job?.id || 'unknown'} failed: ${formatError(err)}`)
);
worker.on('error', err => 
  logger.error(`Worker error: ${formatError(err)}`)
);

export default worker;