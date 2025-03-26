import { config } from '@/config';
import { mkdir } from 'fs/promises';
import { logger } from './logger';

/**
 * Ensures all required directories exist
 */
export const initializeDirectories = async (): Promise<void> => {
  try {
    // Ensure uploads directory exists
    await mkdir(config.uploadsDir, { recursive: true });
    logger.info(`Ensured uploads directory exists: ${config.uploadsDir}`);
  } catch (error) {
    logger.error(`Failed to initialize directories: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}; 