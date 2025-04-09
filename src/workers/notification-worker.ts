import { config } from '@/config'; // Your config (e.g., Redis connection)
import { log } from '@/utils/logger'; // Use 'log' object
import { sendToSubscribedClients } from '@/utils/websocket'; // Import the specific function
import { Queue, Worker } from 'bullmq';

// Assume this is your notification queue
export const notificationQueue = new Queue('notifications', {
  connection: config.redis, // Redis connection details
});

// Define the worker to process jobs from the notification queue
const notificationWorker = new Worker(
  'notifications', // Must match the queue name
  async (job) => {
    // Extract data from the job
    const { type, userId, topic, payload, timestamp } = job.data;

    try {
      // Updated usage:
      // Call the imported function directly
      sendToSubscribedClients(userId, topic, {
        type,
        timestamp,
        payload,
      });
      log.debug(`Processed notification`, { type, userId, topic });
    } catch (error) {
      // Log and re-throw the error for retries
      log.error(
        `Failed to process notification ${type} for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  },
  {
    connection: config.redis, // Same Redis connection as the queue
    concurrency: 5, // Process up to 5 jobs concurrently
  }
);

// Log worker events for debugging
notificationWorker.on('completed', (job) => {
  log.debug(`Notification job completed`, { jobId: job.id });
});

notificationWorker.on('failed', (job, err) => {
  log.error(`Notification job failed`, { jobId: job?.id, error: err.message });
});

// Graceful shutdown to close the worker
const gracefulShutdown = async (): Promise<void> => {
  log.info('Shutting down server...');
  await notificationWorker.close();
  log.info('Notification worker closed');
  process.exit(0);
};

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);