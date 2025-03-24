// src/index.ts
import { app } from '@/api';
import { config } from '@/config';
import { initSchema } from '@/database/schema';
import { logger } from '@/utils/logger';
import { websocketManager } from '@/utils/websocket';
import { createServer } from 'http';

// Initialize database schema
initSchema();

// Create HTTP server instance
const server = createServer(app);

// Initialize WebSocket server
websocketManager.initialize(server);

// Start the server
server.listen(config.port, () => {
  logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
});

// Handle graceful shutdown
const gracefulShutdown = async (): Promise<void> => {
  logger.info('Shutting down server...');
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close WebSocket connections
    websocketManager.shutdown();
    
    // Close database (if needed)
    // Any other cleanup...
    
    logger.info('Shutdown complete');
    process.exit(0);
  });
  
  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);