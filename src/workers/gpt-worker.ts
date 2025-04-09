import { config } from '@/config';
import { query, queryOne, transaction } from '@/database';
import { ExternalServiceError } from '@/middleware/error';
import { sendConversationNotification, sendStatusNotification } from '@/services/notification-service';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
import { generateGptResponse } from '@/utils/openai';
import { SYSTEM_PROMPTS } from '@/utils/system-prompts';
import { sanitizeInput } from '@/utils/validation';
import { Job, Worker, type ConnectionOptions } from 'bullmq';

import type { Audio, Conversation } from '@/types';

/**
 * Creates a sanitized prompt for GPT based on conversation details.
 * @param mode Conversation mode (e.g., 'therapy', 'coaching').
 * @param recordingType 'separate' or 'live'.
 * @param transcriptions Array of sanitized transcription strings.
 * @returns The fully formatted prompt string.
 * @throws If the mode is invalid or transcriptions are missing/incorrect count.
 */
const _createGptPrompt = (
  mode: string,
  recordingType: 'separate' | 'live',
  transcriptions: string[]
): string => {
  const systemPrompt = SYSTEM_PROMPTS[mode as keyof typeof SYSTEM_PROMPTS];
  if (!systemPrompt) {
    log.warn('Invalid conversation mode requested for GPT prompt', { mode });
    throw new Error(`Invalid conversation mode: ${mode}`);
  }

  // Basic validation already happened in the main handler, but double-check here
  if (transcriptions.length === 0) {
    throw new Error('Cannot create prompt with no transcriptions.');
  }
  if (recordingType === 'separate' && transcriptions.length !== 2) {
    throw new Error(`Expected 2 transcriptions for separate mode, got ${transcriptions.length}.`);
  }
  if (recordingType === 'live' && transcriptions.length !== 1) {
    throw new Error(`Expected 1 transcription for live mode, got ${transcriptions.length}.`);
  }

  // Sanitize again just in case (defense in depth)
  const sanitizedTranscriptions = transcriptions.map(t => sanitizeInput(t));

  // Format based on recording type
  if (recordingType === 'separate') {
    return `${systemPrompt}\n\nPartner 1: ${sanitizedTranscriptions[0]}\nPartner 2: ${sanitizedTranscriptions[1]}`;
  } else { // 'live'
    return `${systemPrompt}\n\nConversation: ${sanitizedTranscriptions[0]}`;
  }
};

/**
 * Queue connection configuration with retry logic
 */
const queueConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port
};

/**
 * Worker for processing GPT requests
 */
const worker = new Worker(
  'gptProcessing',
  async (job: Job) => {
    const { conversationId, userId } = job.data;
    
    log.info(`Processing GPT job`, { jobId: job.id, conversationId });
    
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
      const prompt = _createGptPrompt(conversation.mode, conversation.recordingType, transcriptions);
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
      
      log.info(`Successfully processed conversation`, { conversationId });
      return { success: true };
    } catch (error) {
      // Handle specific errors
      if (error instanceof ExternalServiceError) {
        log.error(`External service error processing conversation`, { conversationId, error: error.message });
      } else {
        log.error(`GPT processing failed`, { jobId: job.id, error: formatError(error) });
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
        log.error(`Failed to send error notification after GPT failure`, { userId, conversationId, error: formatError(notificationError) });
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
worker.on('completed', (job: Job) => log.info(`GPT job completed successfully`, { jobId: job.id }));
worker.on('failed', (job: Job | undefined, err: Error) => 
  log.error(`GPT job failed`, { jobId: job?.id || 'unknown', error: formatError(err) })
);
worker.on('error', err => 
  log.error(`GPT worker error`, { error: formatError(err) })
);

export default worker;