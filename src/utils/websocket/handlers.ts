// /Users/adimov/Developer/final/check/src/utils/websocket/handlers.ts
import type { BaseWebSocketIncomingMessage } from '@/types/websocket';
import { WebSocketMessageFactory } from '@/types/websocket'; // Import factory
import { log } from '@/utils/logger';
import { sendBufferedMessages } from './messaging';
import type { WebSocketClient } from './state';

// Handle subscription request
async function handleSubscription(ws: WebSocketClient, topic: string): Promise<void> {
  if (!ws.userId) {
    log.warn('Attempted subscription without authentication');
    return;
  }

  // --- MODIFICATION: Add topic *before* sending buffered messages ---
  const isNewSubscription = !ws.subscribedTopics.has(topic);
  if (isNewSubscription) {
      ws.subscribedTopics.add(topic); // Add topic immediately
      log.info(`User ${ws.userId} subscribed to topic: ${topic}`);
      // Send confirmation back to the client
      try {
          ws.send(WebSocketMessageFactory.subscriptionConfirmed(topic));
      } catch (e) {
          log.error(`Failed to send subscription confirmation for ${topic} to ${ws.userId}`, { error: e });
      }
      // Send buffered messages *after* adding the topic and sending confirmation
      await sendBufferedMessages(ws, topic);
  } else {
      log.debug(`User ${ws.userId} already subscribed to topic: ${topic}. Sending buffered messages anyway.`);
      // Still send buffered messages in case the client reconnected and missed some
      await sendBufferedMessages(ws, topic);
  }
  // --- END MODIFICATION ---
}


// Handle unsubscription request
function handleUnsubscription(ws: WebSocketClient, topic: string): void {
  if (!ws.userId) {
    log.warn('Attempted unsubscription without authentication');
    return;
  }

  if (ws.subscribedTopics.has(topic)) {
      ws.subscribedTopics.delete(topic);
      log.info(`User ${ws.userId} unsubscribed from topic: ${topic}`);
      // Send confirmation back to the client
      try {
          ws.send(WebSocketMessageFactory.unsubscriptionConfirmed(topic));
      } catch (e) {
          log.error(`Failed to send unsubscription confirmation for ${topic} to ${ws.userId}`, { error: e });
      }
  } else {
      log.debug(`User ${ws.userId} attempted to unsubscribe from non-subscribed topic: ${topic}`);
  }
}


// Handle ping message
function handlePing(ws: WebSocketClient): void {
  ws.isAlive = true;
  // --- MODIFICATION: Use factory for pong ---
  try {
      ws.send(WebSocketMessageFactory.pong());
  } catch (e) {
      log.error(`Failed to send pong to ${ws.userId}`, { error: e });
  }
  // --- END MODIFICATION ---
}


// Main message handler for authenticated clients
export function handleAuthenticatedMessage(ws: WebSocketClient, message: BaseWebSocketIncomingMessage): void {
  // Log the received message details
  log.debug(`[WS] Received message from ${ws.userId}: type=${message.type}`, { payload: message.payload });

  switch (message.type) {
    case 'subscribe':
      if (typeof message.payload?.topic === 'string' && message.payload.topic.startsWith('conversation:')) {
        handleSubscription(ws, message.payload.topic);
      } else {
        log.warn(`Invalid subscribe message from ${ws.userId}: Invalid or missing topic`, { payload: message.payload });
        // Optionally send an error back to the client
      }
      break;
    case 'unsubscribe':
      if (typeof message.payload?.topic === 'string' && message.payload.topic.startsWith('conversation:')) {
        handleUnsubscription(ws, message.payload.topic);
      } else {
        log.warn(`Invalid unsubscribe message from ${ws.userId}: Invalid or missing topic`, { payload: message.payload });
        // Optionally send an error back to the client
      }
      break;
    case 'ping':
      handlePing(ws);
      break;
    default:
      log.warn(`Unhandled message type from ${ws.userId}: ${message.type}`);
      // Optionally send an error back to the client
      try {
          ws.send(WebSocketMessageFactory.error(`Unhandled message type: ${message.type}`));
      } catch (e) {
          log.error(`Failed to send unhandled message type error to ${ws.userId}`, { error: e });
      }
  }
}