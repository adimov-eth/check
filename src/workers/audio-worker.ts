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
  
  logger.debug('Audio processing details:', {
    jobId: job.id,
    audioId,
    conversationId,
    userId,
    audioPath
  });

  try {
    // Update audio status to processing
    logger.debug(`Updating audio status to processing for audioId: ${audioId}`);
    await updateAudioStatus(audioId, 'processing');
    
    // Transcribe the audio
    logger.debug(`Starting transcription for audioId: ${audioId}`);
    const transcription = await transcribeAudio(audioPath);
    logger.debug(`Transcription completed for audioId: ${audioId}`, {
      transcriptionLength: transcription?.length || 0
    });
    
    // Update the audio record with transcription and remove audio file path
    logger.debug(`Updating audio status to transcribed for audioId: ${audioId}`);
    await updateAudioStatus(audioId, 'transcribed', transcription);
    
    // Delete the audio file to save space only after successful transcription
    logger.debug(`Deleting audio file: ${audioPath}`);
    await deleteFile(audioPath);
    
    // Get conversation details to check recording type
    logger.debug(`Fetching conversation details for conversationId: ${conversationId}`);
    const conversation = await getConversationById(conversationId, userId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Check if all required audio files for this conversation have been transcribed
    logger.debug(`Checking transcription status for conversation: ${conversationId}`);
    const audios = await getConversationAudios(conversationId);
    const transcribedCount = audios.filter(audio => audio.status === 'transcribed').length;
    const requiredAudios = conversation.recordingType === 'separate' ? 2 : 1;
    
    logger.debug('Transcription progress:', {
      conversationId,
      transcribedCount,
      requiredAudios,
      recordingType: conversation.recordingType
    });
    
    if (transcribedCount === requiredAudios) {
      // Update conversation status
      logger.debug(`Updating conversation ${conversationId} status to processing`);
      await updateConversationStatus(conversationId, 'processing');
      
      // Add to GPT queue with retry options
      logger.debug(`Adding conversation ${conversationId} to GPT queue`);
      await gptQueue.add(
        'process_conversation', 
        { conversationId, userId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      );
      
      logger.info(`All required audios transcribed for conversation: ${conversationId}`, {
        transcribedCount,
        requiredAudios
      });
    }
    
    const totalDuration = Date.now() - startTime;
    logger.info(`Audio job completed for audioId: ${audioId}`, {
      duration: totalDuration,
      jobId: job.id,
      conversationId
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Audio processing failed for job ${job.id}`, {
      error: errorMessage,
      audioId,
      conversationId,
      duration: Date.now() - startTime
    });
    
    try {
      // Update audio status to failed
      logger.debug(`Updating audio status to failed for audioId: ${audioId}`);
      await updateAudioStatus(
        audioId, 
        'failed', 
        undefined, 
        errorMessage
      );
      
      // Cleanup the audio file on failure
      logger.debug(`Cleaning up audio file after failure: ${audioPath}`);
      await cleanupOnFailure(audioPath);
    } catch (updateError) {
      logger.error(`Failed to update audio status for audioId: ${audioId}`, {
        error: updateError instanceof Error ? updateError.message : String(updateError)
      });
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