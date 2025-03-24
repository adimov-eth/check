// src/utils/websocket.ts
import { Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from './logger';

interface WebSocketClient extends WebSocket {
  userId?: string;
  isAlive: boolean;
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Set<WebSocketClient>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  public initialize(server: Server, path = '/ws'): void {
    this.wss = new WebSocketServer({ server, path });
    
    logger.info(`WebSocket server initialized on path: ${path}`);

    this.wss.on('connection', (ws: WebSocketClient, req) => {
      ws.isAlive = true;
      
      // Parse the JWT token from query params
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }

      // In a real implementation, you'd verify the token
      // For now, we'll just extract a user ID
      try {
        // Mock JWT parsing - in real app would use proper verification
        const userId = token.split('.')[0];
        ws.userId = userId;
        
        if (!this.clients.has(userId)) {
          this.clients.set(userId, new Set());
        }
        this.clients.get(userId)?.add(ws);
        
        logger.info(`WebSocket client connected: ${userId}`);
      } catch (error) {
        logger.error(`WebSocket client connection error: ${error}`);
        ws.close(1008, 'Authentication failed');
        return;
      }

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', () => {
        if (ws.userId) {
          this.clients.get(ws.userId)?.delete(ws);
          if (this.clients.get(ws.userId)?.size === 0) {
            this.clients.delete(ws.userId);
          }
        }
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        payload: { message: 'Connected to WebSocket server' }
      }));
    });

    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.wss?.clients.forEach((ws) => {
        const client = ws as WebSocketClient;
        if (client.isAlive === false) {
          return client.terminate();
        }
        
        client.isAlive = false;
        client.ping();
      });
    }, 30000); // 30 seconds
  }

  public sendToUser(userId: string, data: unknown): void {
    if (!this.wss) return;
    
    const userClients = this.clients.get(userId);
    if (!userClients || userClients.size === 0) return;
    
    const message = JSON.stringify(data);
    
    userClients.forEach(client => {
      client.send(message);
    });
  }

  public broadcast(data: unknown): void {
    if (!this.wss) return;
    
    const message = JSON.stringify(data);
    
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

// Create singleton instance
export const websocketManager = new WebSocketManager();