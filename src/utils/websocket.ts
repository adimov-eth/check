// src/utils/websocket.ts
import type { WebSocketMessage } from '@/types/websocket';
import { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from './logger';

interface WebSocketClient extends WebSocket {
  userId: string;
  isAlive: boolean;
  subscribedTopics: Set<string>;
}

interface BufferedMessage {
  topic: string;
  userId: string;
  data: WebSocketMessage;
  timestamp: number;
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Set<WebSocketClient>>();
  private pingInterval: NodeJS.Timer | null = null;
  private messageBuffer: BufferedMessage[] = [];
  private readonly maxBufferSize = 100;
  private readonly messageExpiry = 1000 * 60 * 5; // 5 minutes in milliseconds

  public initialize(server: Server, path = '/ws'): void {
    this.wss = new WebSocketServer({ noServer: true });
    logger.info(`WebSocket server initialized on path: ${path}`);
    this.setupConnectionHandler();
    this.startPingInterval();
    this.startBufferCleanupInterval();
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
      
      // Store client in users map
      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set());
      }
      this.clients.get(userId)!.add(ws);
      
      // Mark client as alive for ping/pong mechanism
      ws.isAlive = true;
      
      logger.info(`WebSocket client connected: ${userId}, active connections: ${this.clients.get(userId)?.size || 0}`);

      // Handle ping/pong for connection health monitoring
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const rawMessage = message.toString();
          logger.debug(`Received message from client ${userId}: ${rawMessage}`);
          
          const data = JSON.parse(rawMessage);
          
          if (data.type === 'subscribe' && data.topic) {
            // Add topic to client's subscriptions
            ws.subscribedTopics.add(data.topic);
            logger.info(`Client ${userId} subscribed to ${data.topic}`);
            
            // Send confirmation of subscription to client
            ws.send(JSON.stringify({
              type: 'subscription_confirmed',
              timestamp: new Date().toISOString(),
              payload: { 
                topic: data.topic,
                activeSubscriptions: Array.from(ws.subscribedTopics) 
              }
            }));
            
            // Send any buffered messages for this topic
            this.sendBufferedMessages(ws, data.topic);
            
            logger.debug(`Client ${userId} subscriptions: ${Array.from(ws.subscribedTopics).join(', ')}`);
          } else if (data.type === 'unsubscribe' && data.topic) {
            ws.subscribedTopics.delete(data.topic);
            logger.info(`Client ${userId} unsubscribed from ${data.topic}`);
            
            // Send confirmation of unsubscription
            ws.send(JSON.stringify({
              type: 'unsubscription_confirmed',
              timestamp: new Date().toISOString(),
              payload: { 
                topic: data.topic,
                activeSubscriptions: Array.from(ws.subscribedTopics) 
              }
            }));
          } else if (data.type === 'ping') {
            // Explicit application-level ping (in addition to WebSocket protocol level ping)
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString(),
              payload: { serverTime: new Date().toISOString() }
            }));
          } else {
            logger.debug(`Received unknown message type: ${data.type}`);
          }
        } catch (error) {
          logger.error(`Error processing message: ${error}`);
          // Don't log entire message content as it might contain sensitive information
          logger.error(`Failed to parse message from user ${userId}`);
        }
      });

      ws.on('close', (code, reason) => {
        // Clean up client resources
        this.clients.get(userId)?.delete(ws);
        if (this.clients.get(userId)?.size === 0) {
          this.clients.delete(userId);
        }
        
        logger.info(`WebSocket client disconnected: ${userId}, code: ${code}, reason: ${reason || 'No reason provided'}`);
        logger.info(`Remaining active connections for user ${userId}: ${this.clients.get(userId)?.size || 0}`);
      });

      // Send initial connection confirmation with server information
      ws.send(
        JSON.stringify({
          type: 'connected',
          timestamp: new Date().toISOString(),
          payload: { 
            message: 'Connected to WebSocket server',
            serverTime: new Date().toISOString(),
            connectionId: Math.random().toString(36).substring(2, 15)
          },
        })
      );
    });
  }
  
  // Send any buffered messages for the topic to this specific client
  private sendBufferedMessages(ws: WebSocketClient, topic: string): void {
    logger.info(`Sending buffered messages for topic ${topic} to user ${ws.userId}`);
    
    const now = Date.now();
    let sentCount = 0;
    
    // Find buffered messages for this user and topic
    this.messageBuffer
      .filter(msg => msg.userId === ws.userId && msg.topic === topic && (now - msg.timestamp) < this.messageExpiry)
      .sort((a, b) => a.timestamp - b.timestamp) // Process in chronological order
      .forEach(msg => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg.data));
            sentCount++;
          }
        } catch (error) {
          logger.error(`Error sending buffered message: ${error}`);
        }
      });
    
    if (sentCount > 0) {
      logger.info(`Sent ${sentCount} buffered messages for topic ${topic} to user ${ws.userId}`);
    }
  }

  private startPingInterval(): void {
    // Ping all clients every 30 seconds for connection health monitoring
    this.pingInterval = setInterval(() => {
      this.wss?.clients.forEach((ws) => {
        const client = ws as WebSocketClient;
        
        // If client has not responded to previous ping, terminate the connection
        if (!client.isAlive) {
          logger.debug(`Terminating inactive WebSocket for user ${client.userId}`);
          return client.terminate();
        }
        
        // Mark as not alive, will be reset when pong is received
        client.isAlive = false;
        
        // Send a ping
        try {
          client.ping();
        } catch (error) {
          logger.error(`Error sending ping to client ${client.userId}: ${error}`);
          client.terminate();
        }
      });
    }, 30000); // Ping every 30 seconds
  }

  // Clean up expired messages from buffer
  private startBufferCleanupInterval(): void {
    setInterval(() => {
      const initialCount = this.messageBuffer.length;
      const now = Date.now();
      
      // Remove expired messages
      this.messageBuffer = this.messageBuffer.filter(
        msg => (now - msg.timestamp) < this.messageExpiry
      );
      
      const removedCount = initialCount - this.messageBuffer.length;
      if (removedCount > 0) {
        logger.debug(`Removed ${removedCount} expired messages from buffer`);
      }
    }, 60000); // Clean up every minute
  }

  public sendToUser(userId: string, data: WebSocketMessage): void {
    const userClients = this.clients.get(userId);
    if (!userClients) {
      logger.debug(`No active clients for user ${userId}`);
      return;
    }
    
    const message = JSON.stringify(data);
    let sentCount = 0;
    
    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          sentCount++;
        } catch (error) {
          logger.error(`Error sending message to user ${userId}: ${error}`);
        }
      }
    });
    
    logger.debug(`Sent message to ${sentCount}/${userClients.size} clients for user ${userId}`);
  }

  public sendToSubscribedClients(userId: string, topic: string, data: WebSocketMessage): void {
    const userClients = this.clients.get(userId);
    
    logger.debug(`Attempting to send message to topic ${topic} for user ${userId}`);
    
    if (!userClients || userClients.size === 0) {
      logger.warn(`No connected clients found for user ${userId}`);
      // Buffer the message for later delivery
      this.bufferMessage(userId, topic, data);
      return;
    }
    
    const message = JSON.stringify(data);
    let sentCount = 0;
    let notSubscribedCount = 0;
    let closedCount = 0;
    
    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        if (client.subscribedTopics.has(topic)) {
          try {
            client.send(message);
            sentCount++;
            logger.debug(`Message sent to client subscribed to ${topic}`);
          } catch (error) {
            logger.error(`Error sending message to client for topic ${topic}: ${error}`);
          }
        } else {
          notSubscribedCount++;
          logger.debug(`Client is connected but not subscribed to ${topic}. Subscribed topics: ${Array.from(client.subscribedTopics).join(', ')}`);
        }
      } else {
        closedCount++;
        logger.debug(`Client for user ${userId} is not in OPEN state. Current state: ${client.readyState}`);
      }
    });
    
    if (sentCount === 0) {
      // If we couldn't send to any clients, buffer the message
      this.bufferMessage(userId, topic, data);
    }
    
    logger.debug(`Message delivery report for topic ${topic}: sent=${sentCount}, not subscribed=${notSubscribedCount}, closed=${closedCount}, total clients=${userClients.size}`);
  }

  private bufferMessage(userId: string, topic: string, data: WebSocketMessage): void {
    // Add the message to the buffer with a timestamp
    this.messageBuffer.push({
      userId,
      topic,
      data,
      timestamp: Date.now()
    });
    
    // If the buffer exceeds its maximum size, remove the oldest messages
    if (this.messageBuffer.length > this.maxBufferSize) {
      const overflow = this.messageBuffer.length - this.maxBufferSize;
      this.messageBuffer.splice(0, overflow);
      logger.debug(`Message buffer overflow, removed ${overflow} oldest messages`);
    }
    
    logger.debug(`Buffered message for user ${userId} and topic ${topic}, buffer size: ${this.messageBuffer.length}`);
  }

  public broadcast(data: WebSocketMessage): void {
    if (!this.wss) {
      logger.warn('Attempted to broadcast message but WebSocket server is not initialized');
      return;
    }
    
    const message = JSON.stringify(data);
    let sentCount = 0;
    let totalClients = 0;
    
    this.wss.clients.forEach((client) => {
      totalClients++;
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          sentCount++;
        } catch (error) {
          logger.error(`Error broadcasting message to client: ${error}`);
        }
      }
    });
    
    logger.debug(`Broadcast message sent to ${sentCount}/${totalClients} clients`);
  }

  public shutdown(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.wss?.close();
    logger.info('WebSocket server shut down');
  }
}

export const websocketManager = new WebSocketManager();