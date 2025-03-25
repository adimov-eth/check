// src/utils/websocket.ts
import { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from './logger';

interface WebSocketClient extends WebSocket {
  userId: string;
  isAlive: boolean;
  subscribedTopics: Set<string>;
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Set<WebSocketClient>>();
  private pingInterval: NodeJS.Timer | null = null;

  public initialize(server: Server, path = '/ws'): void {
    this.wss = new WebSocketServer({ noServer: true });
    logger.info(`WebSocket server initialized on path: ${path}`);
    this.setupConnectionHandler();
    this.startPingInterval();
  }

  public handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer, userId: string): void {
    if (!this.wss) return;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const client = ws as WebSocketClient;
      client.userId = userId;
      client.isAlive = true;
      client.subscribedTopics = new Set();
      this.wss!.emit('connection', client, req);
    });
  }

  private setupConnectionHandler(): void {
    if (!this.wss) return;
    this.wss.on('connection', (ws: WebSocketClient) => {
      const userId = ws.userId;
      if (!this.clients.get(userId)?.add(ws)) {
        this.clients.set(userId, new Set([ws]));
      }
      logger.info(`WebSocket client connected: ${userId}`);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'subscribe' && data.topic) {
            ws.subscribedTopics.add(data.topic);
            logger.debug(`Client ${userId} subscribed to ${data.topic}`);
          } else if (data.type === 'unsubscribe' && data.topic) {
            ws.subscribedTopics.delete(data.topic);
            logger.debug(`Client ${userId} unsubscribed from ${data.topic}`);
          }
        } catch (error) {
          logger.error(`Error processing message: ${error}`);
        }
      });

      ws.on('close', () => {
        this.clients.get(userId)?.delete(ws);
        if (this.clients.get(userId)?.size === 0) this.clients.delete(userId);
        logger.info(`WebSocket client disconnected: ${userId}`);
      });

      ws.send(
        JSON.stringify({
          type: 'connected',
          timestamp: new Date().toISOString(),
          payload: { message: 'Connected to WebSocket server' },
        })
      );
    });
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      this.wss?.clients.forEach((ws) => {
        const client = ws as WebSocketClient;
        if (!client.isAlive) return client.terminate();
        client.isAlive = false;
        client.ping();
      });
    }, 30000); // Ping every 30 seconds
  }

  public sendToUser(userId: string, data: unknown): void {
    const userClients = this.clients.get(userId);
    if (!userClients) return;
    const message = JSON.stringify(data);
    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  public sendToSubscribedClients(userId: string, topic: string, data: unknown): void {
    const userClients = this.clients.get(userId);
    if (!userClients) return;
    const message = JSON.stringify(data);
    userClients.forEach((client) => {
      if (client.subscribedTopics.has(topic) && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public broadcast(data: unknown): void {
    if (!this.wss) return;
    const message = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  public shutdown(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.wss?.close();
    logger.info('WebSocket server shut down');
  }
}

export const websocketManager = new WebSocketManager();