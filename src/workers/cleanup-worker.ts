import { config } from '@/config';
import { getAudioByPath } from '@/services/audio-service';
import { formatError } from '@/utils/error-formatter';
import { deleteFile, getFileAge } from '@/utils/file';
import { log } from '@/utils/logger';
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
          log.info(`Deleted orphaned file`, { filePath });
        }
      } catch (error) {
        log.error(`Error processing file for cleanup`, { filePath, error: formatError(error) });
      }
    }
    
    log.info('Cleanup job completed successfully');
  } catch (error) {
    log.error(`Cleanup job failed`, { error: formatError(error) });
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

worker.on('completed', job => log.info(`Cleanup job completed successfully`, { jobId: job.id }));
worker.on('failed', (job, err) => log.error(`Cleanup job failed`, { jobId: job?.id, error: err.message }));

export default worker; 