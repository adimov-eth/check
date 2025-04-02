import { redisClient } from '@/config';
import type { WebSocketMessage } from '@/types/websocket';
import { WebSocket } from 'ws';
import { logger } from '../logger';
import { getClientsByUserId, getWss, type WebSocketClient } from './state';

const MESSAGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const BUFFER_MAX_LENGTH = 50; // Keep last 50 messages
const BUFFER_EXPIRY_SECONDS = 86400; // 1 day

// --- Buffering Logic ---

export async function sendBufferedMessages(ws: WebSocketClient, topic: string): Promise<void> {
    if (!ws.userId) {
        logger.warn("Attempted to send buffered messages to unauthenticated client.");
        return;
    }
    const key = `ws:buffer:${ws.userId}:${topic}`;
    try {
        const messages = await redisClient.lRange(key, 0, -1);
        if (messages.length === 0) {
            logger.debug(`No buffered messages found for ${key}`);
            return;
        }

        const now = Date.now();
        let sentCount = 0;
        let skippedCount = 0;
        let expiredCount = 0;
        const messagesToSend: WebSocketMessage[] = [];

        for (const msgString of messages) {
            try {
                const msg = JSON.parse(msgString);
                if ((now - msg.timestamp) < MESSAGE_EXPIRY_MS) {
                    messagesToSend.push(msg.data as WebSocketMessage);
                } else {
                    expiredCount++;
                }
            } catch (parseError) {
                logger.error(`Failed to parse buffered message from Redis (${key}): ${parseError}`);
            }
        }

        logger.info(`Processing ${messagesToSend.length} non-expired buffered messages for ${key} (${expiredCount} expired)`);

        for (const msgData of messagesToSend) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msgData));
                sentCount++;
            } else {
                skippedCount++;
                if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                    logger.warn(`Client ${ws.userId} connection closed while sending buffered messages. Stopping.`);
                    break; // Stop sending if client disconnected
                }
            }
        }

        if (messagesToSend.length > 0 || expiredCount > 0) {
            await redisClient.del(key); // Clear buffer after processing
            logger.info(`Cleared Redis buffer ${key} after processing.`);
        }

        logger.info(`Buffered message delivery report for user ${ws.userId}, topic ${topic}: Sent: ${sentCount}, Skipped: ${skippedCount}, Expired: ${expiredCount}, Total Buffered: ${messages.length}`);

    } catch (redisError) {
        logger.error(`Redis error fetching/processing buffered messages for ${key}: ${redisError}`);
    }
}

export async function bufferMessage(userId: string, topic: string, data: WebSocketMessage): Promise<void> {
    const messageData = {
        ...data,
        timestamp: data.timestamp || new Date().toISOString() // Ensure timestamp exists
    };
    const key = `ws:buffer:${userId}:${topic}`;
    // Store the message data along with a current timestamp for expiry check
    const messageToStore = JSON.stringify({ data: messageData, timestamp: Date.now() });

    try {
        await redisClient.rPush(key, messageToStore);
        await redisClient.lTrim(key, -BUFFER_MAX_LENGTH, -1); // Keep only the last N messages
        await redisClient.expire(key, BUFFER_EXPIRY_SECONDS); // Set expiry for the list
        const listLength = await redisClient.lLen(key) || 0;
        logger.debug(`Buffered message for user ${userId}, topic ${topic}. Redis list size: ${listLength}`);
    } catch (redisError) {
        logger.error(`Redis error buffering message for ${key}: ${redisError}`);
    }
}

// --- Sending Logic ---

export function sendToUser(userId: string, data: WebSocketMessage): void {
    const userClients = getClientsByUserId().get(userId);
    if (!userClients || userClients.size === 0) {
        logger.debug(`No active clients for user ${userId}, cannot send message directly.`);
        // Note: Messages sent directly via sendToUser are generally not buffered.
        // Buffering is primarily for subscription-based messages.
        return;
    }

    const message = JSON.stringify(data);
    let sentCount = 0;

    userClients.forEach((client) => {
        if (client.userId === userId && !client.isAuthenticating && client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                sentCount++;
            } catch (error) {
                logger.error(`Error sending direct message to user ${userId} (client instance): ${error}`);
                // Optionally: Handle client termination on send error
                // client.terminate();
            }
        }
    });
    logger.debug(`Sent direct message to ${sentCount}/${userClients.size} clients for user ${userId}`);
}

export function sendToSubscribedClients(userId: string, topic: string, data: WebSocketMessage): void {
    const userClients = getClientsByUserId().get(userId);
    logger.debug(`Attempting to send message to topic ${topic} for user ${userId}`);

    if (!userClients || userClients.size === 0) {
        logger.warn(`No connected clients found for user ${userId}. Buffering message for topic ${topic}.`);
        bufferMessage(userId, topic, data);
        return;
    }

    const message = JSON.stringify(data);
    let sentCount = 0;
    let notSubscribedCount = 0;
    let closedCount = 0;
    let notAuthCount = 0;
    let errorCount = 0;

    userClients.forEach((client) => {
        if (!client.userId || client.userId !== userId || client.isAuthenticating) {
            notAuthCount++;
            return;
        }

        if (client.readyState === WebSocket.OPEN) {
            if (client.subscribedTopics.has(topic)) {
                try {
                    client.send(message);
                    sentCount++;
                    logger.debug(`Message sent to client ${client.userId} subscribed to ${topic}`);
                } catch (error) {
                    logger.error(`Error sending message to client ${client.userId} for topic ${topic}: ${error}`);
                    errorCount++;
                    // Optionally terminate client on send error
                    // client.terminate();
                }
            } else {
                notSubscribedCount++;
            }
        } else {
            closedCount++;
        }
    });

    // Buffer only if no clients successfully received the message AND there were clients for the user
    if (sentCount === 0 && userClients.size > 0) {
        logger.warn(`Message for topic ${topic} not sent to any active, subscribed, open clients for user ${userId}. Buffering.`);
        bufferMessage(userId, topic, data);
    }

    logger.debug(`Message delivery report for user ${userId}, topic ${topic}: sent=${sentCount}, not_subscribed=${notSubscribedCount}, closed=${closedCount}, not_auth=${notAuthCount}, errors=${errorCount}, total_clients=${userClients.size}`);
}

export function broadcast(data: WebSocketMessage): void {
    const wss = getWss();
    if (!wss) {
        logger.warn('Attempted to broadcast message but WebSocket server is not initialized');
        return;
    }

    const message = JSON.stringify(data);
    let sentCount = 0;
    let totalClients = 0;
    let errorCount = 0;

    wss.clients.forEach((client) => {
        totalClients++;
        const wsClient = client as WebSocketClient; // Assuming all clients are WebSocketClient
        if (wsClient.userId && !wsClient.isAuthenticating && wsClient.readyState === WebSocket.OPEN) {
            try {
                wsClient.send(message);
                sentCount++;
            } catch (error) {
                logger.error(`Error broadcasting message to client ${wsClient.userId}: ${error}`);
                errorCount++;
                // Optionally terminate client on send error
                // wsClient.terminate();
            }
        }
    });

    logger.debug(`Broadcast message: Sent to ${sentCount} authenticated clients. Errors: ${errorCount}. Total connected: ${totalClients}.`);
}