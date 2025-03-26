// src/index.ts
import { app } from '@/api';
import { config } from '@/config';
import { initSchema } from '@/database/schema';
import { verifySessionToken } from '@/utils/auth';
import { initializeDirectories } from '@/utils/init';
import { logger } from '@/utils/logger';
import { websocketManager } from '@/utils/websocket';
import type { IncomingMessage } from 'http';
import { createServer } from 'http';
import type { Socket } from 'net';

// Initialize database schema and required directories
Promise.all([
  initSchema(),
  initializeDirectories()
]).then(() => {
  const server = createServer(app);
  websocketManager.initialize(server);

  server.on('upgrade', async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    const version = url.searchParams.get('version') || 'v1'; // Track client version
    
    if (!token) {
      logger.warn('WebSocket upgrade attempted without token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const userId = await verifySessionToken(token);
      if (!userId) {
        logger.warn('Invalid token for WebSocket upgrade');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      logger.info(`WebSocket connection established for user ${userId} (version: ${version})`);
      websocketManager.handleUpgrade(req, socket, head, userId);
    } catch (error) {
      logger.error(`WebSocket upgrade error: ${error}`);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  server.listen(config.port, () => {
    logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
  });

  const gracefulShutdown = async (): Promise<void> => {
    logger.info('Shutting down server...');

    server.close(() => {
      logger.info('HTTP server closed');
      websocketManager.shutdown();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}).catch(error => {
  logger.error(`Failed to initialize server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});