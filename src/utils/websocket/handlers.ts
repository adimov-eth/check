import { redisClient } from '@/config';
import { logger } from '../logger';
import { sendBufferedMessages } from './messaging';
import type { WebSocketClient } from './state';

// Base interface for type checking
interface BaseWebSocketIncomingMessage {
    type: string;
    [key: string]: unknown; // Allow other properties
}


interface SubscribeMessage extends BaseWebSocketIncomingMessage {
    type: 'subscribe';
    topic: string;
}

interface UnsubscribeMessage extends BaseWebSocketIncomingMessage {
    type: 'unsubscribe';
    topic: string;
}

interface PingMessage extends BaseWebSocketIncomingMessage {
    type: 'ping';
}

// Type guards for message types
function isSubscribeMessage(data: unknown): data is SubscribeMessage {
    const message = data as BaseWebSocketIncomingMessage;
    return typeof message === 'object' && message !== null && message.type === 'subscribe' && typeof message.topic === 'string' && message.topic.length > 0;
}

function isUnsubscribeMessage(data: unknown): data is UnsubscribeMessage {
    const message = data as BaseWebSocketIncomingMessage;
    return typeof message === 'object' && message !== null && message.type === 'unsubscribe' && typeof message.topic === 'string' && message.topic.length > 0;
}

function isPingMessage(data: unknown): data is PingMessage {
     const message = data as BaseWebSocketIncomingMessage;
     return typeof message === 'object' && message !== null && message.type === 'ping';
}


// --- Message Handlers ---

async function handleSubscribe(ws: WebSocketClient, data: SubscribeMessage): Promise<void> {
    if (!ws.userId) return; // Should not happen if called correctly

    const topic = data.topic;
    // Log subscription attempt
    logger.info(`Client ${ws.userId} attempting to subscribe to ${topic}`);
    ws.subscribedTopics.add(topic);
    logger.info(`Client ${ws.userId} successfully subscribed to ${topic}`);

    const key = `ws:buffer:${ws.userId}:${topic}`;
    const bufferCount = await redisClient.lLen(key) || 0;

    ws.send(JSON.stringify({
        type: 'subscription_confirmed',
        timestamp: new Date().toISOString(),
        payload: {
            topic: topic,
            activeSubscriptions: Array.from(ws.subscribedTopics),
            bufferedMessageCount: bufferCount
        }
    }));

    // Send any buffered messages for this topic
    // Log before sending buffered messages
    logger.info(`Client ${ws.userId} subscribed to ${topic}. Checking for buffered messages (Count: ${bufferCount})...`);
    if (bufferCount > 0) {
      sendBufferedMessages(ws, topic);
    } else {
      logger.debug(`No buffered messages to send for ${topic} to user ${ws.userId}.`);
    }
}

function handleUnsubscribe(ws: WebSocketClient, data: UnsubscribeMessage): void {
     if (!ws.userId) return;

    const topic = data.topic;
    ws.subscribedTopics.delete(topic);
    logger.info(`Client ${ws.userId} unsubscribed from ${topic}`);
    ws.send(JSON.stringify({
        type: 'unsubscription_confirmed',
        timestamp: new Date().toISOString(),
        payload: {
            topic: topic,
            activeSubscriptions: Array.from(ws.subscribedTopics)
        }
    }));
}

function handlePing(ws: WebSocketClient): void {
    ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString(),
        payload: { serverTime: new Date().toISOString() }
    }));
}

export function handleAuthenticatedMessage(ws: WebSocketClient, parsedData: unknown): void {
    if (!ws.userId) {
        logger.warn(`Received message from client marked as authenticated but missing userId. Closing.`);
        ws.close(4003, 'Internal server error: Missing user context');
        return;
    }

    // Use base interface for initial type check
    const messageType = (parsedData as BaseWebSocketIncomingMessage)?.type ?? 'unknown';
    logger.debug(`Received message from authenticated client ${ws.userId}: Type ${messageType}`);

    if (isSubscribeMessage(parsedData)) {
        handleSubscribe(ws, parsedData);
    } else if (isUnsubscribeMessage(parsedData)) {
        handleUnsubscribe(ws, parsedData);
    } else if (isPingMessage(parsedData)) {
        handlePing(ws);
    } else {
        logger.debug(`Received unknown message type from ${ws.userId}: ${messageType}`);
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${messageType}`, timestamp: new Date().toISOString() }));
    }
}