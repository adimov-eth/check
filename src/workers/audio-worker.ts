import { config } from '@/config';
import { gptQueue } from '@/queues';
import { getConversationAudios, updateAudioStatus } from '@/services/audio-service';
import { getConversationById, updateConversationStatus } from '@/services/conversation-service';
import type { AudioJob } from '@/types';
import { deleteFile } from '@/utils/file';
import { logger } from '@/utils/logger';
import { transcribeAudio } from '@/utils/openai';
import { Job, Worker } from 'bullmq';

const cleanupOnFailure = async (audioPath: string): Promise<void> => {
  try {
    await deleteFile(audioPath);
    logger.info(`Cleaned up audio file after failure: ${audioPath}`);
  } catch (error) {
    logger.error(`Failed to cleanup audio file: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const processAudio = async (job: Job<AudioJob>): Promise<void> => {
  const { audioId, conversationId, audioPath, userId } = job.data;
  const startTime = Date.now();
  
  logger.info(`Starting audio processing job ${job.id} for audioId: ${audioId}`);

  try {
    // Update audio status to processing
    await updateAudioStatus(audioId, 'processing');
    
    // Transcribe the audio
    const transcription = await transcribeAudio(audioPath);
    
    // Update the audio record with transcription and remove audio file path
    await updateAudioStatus(audioId, 'transcribed', transcription);
    
    // Delete the audio file to save space only after successful transcription
    await deleteFile(audioPath);
    
    // Get conversation details to check recording type
    const conversation = await getConversationById(conversationId, userId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Check if all required audio files for this conversation have been transcribed
    const audios = await getConversationAudios(conversationId);
    const transcribedCount = audios.filter(audio => audio.status === 'transcribed').length;
    const requiredAudios = conversation.recordingType === 'separate' ? 2 : 1;
    
    if (transcribedCount === requiredAudios) {
      // Update conversation status
      await updateConversationStatus(conversationId, 'processing');
      
      // Add to GPT queue with retry options
      await gptQueue.add(
        'process_conversation', 
        { conversationId, userId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      );
      
      logger.info(`All required audios transcribed for conversation: ${conversationId}`);
    }
    
    const totalDuration = Date.now() - startTime;
    logger.info(`Audio job completed for audioId: ${audioId} in ${totalDuration}ms`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Audio processing failed for job ${job.id}: ${errorMessage}`);
    
    try {
      // Update audio status to failed
      await updateAudioStatus(
        audioId, 
        'failed', 
        undefined, 
        errorMessage
      );
      
      // Cleanup the audio file on failure
      await cleanupOnFailure(audioPath);
    } catch (updateError) {
      logger.error(`Failed to update audio status: ${updateError instanceof Error ? updateError.message : String(updateError)}`);
    }
    
    throw error; // Rethrow for BullMQ to handle retries
  }
};

const worker = new Worker<AudioJob>('audioProcessing', processAudio, {
  connection: config.redis,
  concurrency: 3
});

// Add comprehensive worker event handlers
worker.on('active', job => logger.info(`Audio job ${job.id} started processing`));
worker.on('completed', job => logger.info(`Audio job ${job.id} completed successfully`));
worker.on('failed', (job, err) => logger.error(`Audio job ${job?.id} failed: ${err.message}`));
worker.on('stalled', jobId => logger.error(`Audio job ${jobId} stalled`));
worker.on('error', error => logger.error(`Audio worker error: ${error.message}`));

export default worker;