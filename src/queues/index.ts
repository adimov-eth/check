import { config } from '@/config';
import { Queue } from 'bullmq';
import type { GptJob } from '../types';

interface QueueConfig {
  name: string;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: 'exponential' | 'fixed';
      delay: number;
    };
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
}

// Queue configurations
const queueConfigs: QueueConfig[] = [
  {
    name: 'audioProcessing',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 100 // Keep last 100 failed jobs
    }
  },
  {
    name: 'cleanup',
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 10000
      },
      removeOnComplete: true,
      removeOnFail: 100
    }
  }
];

// Create queue instances
const createQueue = (queueConfig: QueueConfig): Queue => {
  return new Queue(queueConfig.name, {
    connection: config.redis,
    defaultJobOptions: queueConfig.defaultJobOptions
  });
};

// Initialize queues
export const audioQueue = createQueue(queueConfigs[0]);
export const cleanupQueue = createQueue(queueConfigs[1]);
export const gptQueue = new Queue<GptJob>('gptProcessing', {
  connection: config.redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    }
  }
});

// Schedule cleanup job to run every 4 hours
cleanupQueue.add(
  'cleanup',
  { type: 'orphaned_files', maxAgeHours: 24 },
  {
    repeat: {
      pattern: '0 */4 * * *' // At minute 0 past every 4th hour
    },
    jobId: 'scheduled-cleanup' // Fixed jobId to prevent duplicate scheduled jobs
  }
);

// Export all queues
export const queues = {
  audioQueue,
  cleanupQueue,
  gptQueue
};

// Graceful shutdown handler
const gracefulShutdown = async (): Promise<void> => {
  try {
    await Promise.all([
      audioQueue.close(),
      cleanupQueue.close(),
      gptQueue.close()
    ]);
    console.log('Queues closed gracefully');
  } catch (error) {
    console.error('Error closing queues:', error);
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);