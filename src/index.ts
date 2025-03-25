// src/index.ts
import { app } from '@/api';
import { config } from '@/config';
import { initSchema } from '@/database/schema';
import { verifySessionToken } from '@/utils/auth';
import { logger } from '@/utils/logger';
import { websocketManager } from '@/utils/websocket';
import { createServer } from 'http';
import type { Socket } from 'net';

initSchema();

const server = createServer(app);
websocketManager.initialize(server);

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const token = url.searchParams.get('token');
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const userId = await verifySessionToken(token);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    websocketManager.handleUpgrade(req as unknown as Request, socket as unknown as Socket , head, userId);
  } catch (error) {
    logger.error(`WebSocket upgrade error: ${error}`);
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
  }
});

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