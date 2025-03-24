import { audioQueue, gptQueue } from "../queues";
import type { GptJob } from "../types";

type LogLevel = 'info' | 'error';

/**
 * Simple logging function for the queue management script
 */
function log(message: string, level: LogLevel = 'info'): void {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '❌ ERROR:' : '✓';
  console[level === 'error' ? 'error' : 'log'](`[${timestamp}] ${prefix} ${message}`);
}

interface QueueCleanupResult {
  audioJobs: number;
  gptJobs: number;
}

/**
 * Cleans all jobs from the audio and GPT processing queues
 */
export async function cleanQueues(
  cleanAudioQueue = true,
  cleanGptQueue = true
): Promise<QueueCleanupResult> {
  let audioJobs = 0;
  let gptJobs = 0;

  try {
    if (cleanAudioQueue) {
      log('Cleaning audio processing queue...');
      const waiting = await audioQueue.getWaiting();
      const active = await audioQueue.getActive();
      const delayed = await audioQueue.getDelayed();
      const failed = await audioQueue.getFailed();
      const completed = await audioQueue.getCompleted();

      const jobs = [...waiting, ...active, ...delayed, ...failed, ...completed];
      for (const job of jobs) {
        await job.remove();
      }

      audioJobs = jobs.length;
      log(`Removed ${audioJobs} jobs from audio processing queue`);
    }

    if (cleanGptQueue) {
      log('Cleaning GPT processing queue...');
      const waiting = await gptQueue.getWaiting();
      const active = await gptQueue.getActive();
      const delayed = await gptQueue.getDelayed();
      const failed = await gptQueue.getFailed();
      const completed = await gptQueue.getCompleted();

      const jobs = [...waiting, ...active, ...delayed, ...failed, ...completed];
      for (const job of jobs) {
        await job.remove();
      }

      gptJobs = jobs.length;
      log(`Removed ${gptJobs} jobs from GPT processing queue`);
    }

    return { audioJobs, gptJobs };
  } catch (error) {
    log(
      `Error cleaning queues: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    throw error;
  }
}

/**
 * Drains queues by removing all jobs and closing the connections
 */
export async function drainQueues(): Promise<void> {
  try {
    log('Draining audio and GPT queues...');
    await cleanQueues();
    await audioQueue.close();
    await gptQueue.close();
    log('Queues drained and connections closed');
  } catch (error) {
    log(
      `Error draining queues: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    throw error;
  }
}

/**
 * Restarts GPT processing for a specific conversation by removing existing jobs
 * and adding a new one
 */
export async function restartGptProcessing(conversationId: string, userId: string): Promise<boolean> {
  try {
    log(`Restarting GPT processing for conversation: ${conversationId}`);

    // Remove existing jobs for this conversation
    const waitingJobs = await gptQueue.getWaiting();
    const activeJobs = await gptQueue.getActive();
    const delayedJobs = await gptQueue.getDelayed();
    const failedJobs = await gptQueue.getFailed();
    const allJobs = [...waitingJobs, ...activeJobs, ...delayedJobs, ...failedJobs];

    let removed = 0;
    for (const job of allJobs) {
      if (job.data.conversationId === conversationId) {
        await job.remove();
        removed++;
      }
    }
    if (removed > 0) {
      log(`Removed ${removed} existing GPT jobs for conversation: ${conversationId}`);
    }

    // Add a new job to process this conversation
    const job: GptJob = { conversationId, userId };
    await gptQueue.add('process_gpt', job);
    log(`Added new GPT job for conversation: ${conversationId}`);
    
    return true;
  } catch (error) {
    log(
      `Error restarting GPT processing: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    return false;
  }
}

// Add CLI support if this file is run directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];
  const conversationId = args[1];
  const userId = args[2];
  let cleanAudio: boolean;
  let cleanGpt: boolean;
  let success: boolean;

  switch (command) {
    case 'clean':
      cleanAudio = args.includes('--audio') || !args.includes('--gpt');
      cleanGpt = args.includes('--gpt') || !args.includes('--audio');
      await cleanQueues(cleanAudio, cleanGpt);
      break;
    case 'drain':
      await drainQueues();
      break;
    case 'restart':
      if (!conversationId || !userId) {
        console.error('Error: Both conversation ID and user ID are required for restart command');
        process.exit(1);
      }
      success = await restartGptProcessing(conversationId, userId);
      if (!success) {
        process.exit(1);
      }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage:');
      console.error('  clean-queues.ts clean [--audio] [--gpt]');
      console.error('  clean-queues.ts drain');
      console.error('  clean-queues.ts restart <conversationId> <userId>');
      process.exit(1);
  }
}
