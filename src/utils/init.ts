import { config } from '@/config';
import { mkdir } from 'fs/promises';
import { formatError } from './error-formatter';
import { log } from './logger';

/**
 * Ensures all required directories exist
 */
export const initializeDirectories = async (): Promise<void> => {
  try {
    // Ensure uploads directory exists
    await mkdir(config.uploadsDir, { recursive: true });
    log.info(`Ensured uploads directory exists`, { path: config.uploadsDir });
  } catch (error) {
    log.error(`Failed to initialize directories`, { error: formatError(error) });
    throw error;
  }
}; 