import type { BaseWebSocketIncomingMessage } from '@/types/websocket';
import { log } from '@/utils/logger';
import { sendBufferedMessages } from './messaging';
import type { WebSocketClient } from './state';

// Handle subscription request
async function handleSubscription(ws: WebSocketClient, topic: string): Promise<void> {
  if (!ws.userId) {
    log.warn('Attempted subscription without authentication');
    return;
  }

  ws.subscribedTopics.add(topic);
  log.info(`User ${ws.userId} subscribed to topic: ${topic}`);
  
  // Send buffered messages for this topic
  await sendBufferedMessages(ws, topic);
}

// Handle unsubscription request
function handleUnsubscription(ws: WebSocketClient, topic: string): void {
  if (!ws.userId) {
    log.warn('Attempted unsubscription without authentication');
    return;
  }

  ws.subscribedTopics.delete(topic);
  log.info(`User ${ws.userId} unsubscribed from topic: ${topic}`);
}

// Handle ping message
function handlePing(ws: WebSocketClient): void {
  ws.isAlive = true;
  ws.send(JSON.stringify({ type: 'pong' }));
}

// Main message handler for authenticated clients
export function handleAuthenticatedMessage(ws: WebSocketClient, message: BaseWebSocketIncomingMessage): void {
  switch (message.type) {
    case 'subscribe':
      if (typeof message.payload?.topic === 'string') {
        handleSubscription(ws, message.payload.topic);
      }
      break;
    case 'unsubscribe':
      if (typeof message.payload?.topic === 'string') {
        handleUnsubscription(ws, message.payload.topic);
      }
      break;
    case 'ping':
      handlePing(ws);
      break;
    default:
      log.warn(`Unhandled message type: ${message.type}`);
  }
}