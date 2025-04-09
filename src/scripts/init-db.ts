// import { pool } from '@/database'; // Remove pool import
import { runMigrations } from '@/database/migrations'; // Import migrations
// import { initSchema } from '@/database/schema'; // Remove schema import
import { logger } from '@/utils';

async function main() {
  try {
    // await initSchema(); // Replace with runMigrations
    await runMigrations();
    logger.info('Database migrations run successfully.'); // Update log message
  } catch (error) {
    logger.error('Error running database migrations:', error); // Update log message
    throw error;
  } // finally {
    // Remove finally block as db connection is managed globally
    // await pool.close(); 
  // }
}

// Only run if this file is being executed directly
if (import.meta.main) { // Use import.meta.main for Bun
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} 