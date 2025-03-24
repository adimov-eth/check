import { config } from '@/config';
import { query, queryOne } from '@/database';
import { logger } from '@/utils/logger';
import { generateGptResponse } from '@/utils/openai';
import { SYSTEM_PROMPTS } from '@/utils/system-prompts';
import { Job, Worker } from 'bullmq';

import type { Audio, Conversation } from '@/types';

// Function to create prompt based on mode and recording type
const createPrompt = (
  mode: string,
  recordingType: string,
  transcriptions: string[]
) => {
  const systemPrompt = SYSTEM_PROMPTS[mode as keyof typeof SYSTEM_PROMPTS];
  if (!systemPrompt) {
    throw new Error(`Invalid mode: ${mode}`);
  }
  return recordingType === 'separate'
    ? `${systemPrompt}\n\nPartner 1: ${transcriptions[0]}\nPartner 2: ${transcriptions[1]}`
    : `${systemPrompt}\n\nConversation: ${transcriptions[0]}`;
};

// Worker definition
const worker = new Worker(
  'gptProcessing',
  async (job: Job) => {
    try {
      const { conversationId } = job.data;

      // Fetch conversation
      const conversation = await queryOne<Conversation>(
        'SELECT * FROM conversations WHERE id = ?',
        [conversationId]
      );
      
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Fetch audios
      const conversationAudios = await query<Audio>(
        'SELECT * FROM audios WHERE conversationId = ?',
        [conversationId]
      );

      const transcriptions = conversationAudios
        .map(audio => audio.transcription)
        .filter((t): t is string => t !== null);

      // Validate audio count based on recording type
      if (conversation.recordingType === 'separate' && conversationAudios.length !== 2) {
        throw new Error('Expected two audios for separate mode');
      }
      if (conversation.recordingType === 'live' && conversationAudios.length !== 1) {
        throw new Error('Expected one audio for live mode');
      }

      // Generate GPT response
      const prompt = createPrompt(conversation.mode, conversation.recordingType, transcriptions);
      const gptResponse = await generateGptResponse(prompt);

      // Update conversation with response
      await query(
        'UPDATE conversations SET gptResponse = ?, status = ?, updatedAt = ? WHERE id = ?',
        [gptResponse, 'completed', Math.floor(Date.now() / 1000), conversationId]
      );

    } catch (error) {
      logger.error(`GPT processing failed for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error; // Re-throw to mark job as failed
    }
  },
  { connection: config.redis, concurrency: 3 }
);

// Event listeners for logging
worker.on('completed', (job: Job) => logger.info(`GPT job ${job.id} completed`));
worker.on('failed', (job: Job | undefined, err: Error) =>
  logger.error(`GPT job ${job?.id} failed: ${err.message}`)
);

export default worker;