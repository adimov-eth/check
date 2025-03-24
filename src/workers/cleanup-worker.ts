import { config } from '@/config';
import { getAudioByPath } from '@/services/audio-service';
import { deleteFile, getFileAge } from '@/utils/file';
import { logger } from '@/utils/logger';
import { Job, Worker } from 'bullmq';
import { readdir } from 'fs/promises';
import { join } from 'path';

interface CleanupJob {
  type: 'orphaned_files';
  maxAgeHours?: number;
}

const DEFAULT_MAX_AGE_HOURS = 24;

const cleanupOrphanedFiles = async (maxAgeHours: number = DEFAULT_MAX_AGE_HOURS): Promise<void> => {
  try {
    const files = await readdir(config.uploadsDir);
    
    for (const file of files) {
      const filePath = join(config.uploadsDir, file);
      
      try {
        // Check if file is older than maxAgeHours
        const fileAge = getFileAge(filePath);
        if (fileAge < maxAgeHours) {
          continue;
        }
        
        // Check if file exists in database
        const audio = await getAudioByPath(filePath);
        if (!audio) {
          // File is orphaned, delete it
          await deleteFile(filePath);
          logger.info(`Deleted orphaned file: ${filePath}`);
        }
      } catch (error) {
        logger.error(`Error processing file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    logger.info('Cleanup job completed successfully');
  } catch (error) {
    logger.error(`Cleanup job failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

const processCleanup = async (job: Job<CleanupJob>): Promise<void> => {
  const { type, maxAgeHours } = job.data;
  
  switch (type) {
    case 'orphaned_files':
      await cleanupOrphanedFiles(maxAgeHours);
      break;
    default:
      throw new Error(`Unknown cleanup job type: ${type}`);
  }
};

const worker = new Worker<CleanupJob>('cleanup', processCleanup, {
  connection: config.redis,
  concurrency: 1, // Run one cleanup job at a time
});

worker.on('completed', job => logger.info(`Cleanup job ${job.id} completed successfully`));
worker.on('failed', (job, err) => logger.error(`Cleanup job ${job?.id} failed: ${err.message}`));

export default worker; 