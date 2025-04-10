import { config, redisClient } from '@/config'; // Import redisClient
import { log } from '@/utils/logger'; // Use 'log' object
import { Queue, Worker } from 'bullmq';

const WEBSOCKET_NOTIFICATION_CHANNEL = 'websocket-notifications';

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

    // Prepare the message to be published
    const messageToPublish = JSON.stringify({
        userId,
        topic,
        data: { // Encapsulate the actual WS message data
            type,
            timestamp,
            payload,
        }
    });

    try {
      // Publish the message to the Redis channel instead of sending directly
      await redisClient.publish(WEBSOCKET_NOTIFICATION_CHANNEL, messageToPublish);
      log.debug(`Published notification to Redis`, { channel: WEBSOCKET_NOTIFICATION_CHANNEL, type, userId, topic });
    } catch (error) {
      // Log and re-throw the error for retries
      log.error(
        `Failed to publish notification ${type} for user ${userId} to Redis: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Re-throw the error so BullMQ can retry the job
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