// src/index.ts
import { app } from '@/api';
import { config } from '@/config';
// import { initSchema } from '@/database/schema'; // REMOVE THIS LINE
import { logger } from '@/utils/logger';
// Use the correctly exported names from the websocket module
import { runMigrations } from '@/database/migrations'; // Import the migration runner
import { handleUpgrade, initialize, shutdown } from '@/utils/websocket/core';
import type { IncomingMessage } from 'http';
import { createServer } from 'http';
import type { Socket } from 'net';

// Initialize database schema and required directories
const startServer = async () => {
  try {
    // 1. REMOVE Schema Initialization call (now handled by migrations)
    // await initSchema();

    // 2. Run Migrations (handles schema creation and updates)
    await runMigrations(); // This now includes initial schema setup

    // 3. Start your application server
    const server = createServer(app);
    // Initialize WebSocket server using the imported function
    initialize(server, '/ws'); // Pass the server instance and optional path

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      // Ensure the path matches the one used during initialization
      if (url.pathname !== '/ws') {
        logger.debug(`Rejecting upgrade request for path: ${url.pathname}`);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // Handle the upgrade using the imported function
      handleUpgrade(req, socket, head);
    });

    server.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
      logger.info(`WebSocket server accepting connections on ws://localhost:${config.port}/ws`);
    });

    const gracefulShutdown = async (): Promise<void> => {
      logger.info('Shutting down server...');

      // Shutdown WebSocket server first using the imported function
      shutdown();

      // Allow some time for WebSocket connections to close before closing HTTP
      await new Promise(resolve => setTimeout(resolve, 2500)); // Adjust delay if needed

      server.close(async (err) => {
          if (err) {
               logger.error(`Error closing HTTP server: ${err.message}`);
          } else {
               logger.info('HTTP server closed');
          }

          // Disconnect Redis client (if applicable and managed here)
          // await redisClient.quit();
          // logger.info('Redis client disconnected.');

          logger.info('Shutdown complete');
          process.exit(err ? 1 : 0);
      });

      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Graceful shutdown timeout exceeded. Forcing exit.');
        process.exit(1);
      }, 10000); // 10 seconds total timeout
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    logger.error('Server startup failed:', error);
    process.exit(1);
  }
};

startServer();