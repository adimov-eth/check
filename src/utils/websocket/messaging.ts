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
    logger.info(`[sendBufferedMessages] User ${ws.userId} checking Redis buffer: ${key}`);

    try {
        const messages = await redisClient.lRange(key, 0, -1);
        if (messages.length === 0) {
            logger.info(`[sendBufferedMessages] No buffered messages found in Redis for ${key}`);
            return;
        }

        logger.info(`[sendBufferedMessages] Found ${messages.length} raw messages in Redis for ${key}. Processing...`);

        const now = Date.now();
        let sentCount = 0;
        let skippedCount = 0;
        let expiredCount = 0;
        let parseErrorCount = 0;
        const messagesToSend: WebSocketMessage[] = [];

        for (const msgString of messages) {
            try {
                const msg = JSON.parse(msgString);
                if (!msg.data || !msg.timestamp) {
                    logger.warn(`[sendBufferedMessages] Parsed message from ${key} is missing 'data' or 'timestamp'. Skipping.`);
                    parseErrorCount++;
                    continue;
                }
                if ((now - msg.timestamp) < MESSAGE_EXPIRY_MS) {
                    messagesToSend.push(msg.data as WebSocketMessage);
                } else {
                    expiredCount++;
                }
            } catch (parseError) {
                logger.error(`[sendBufferedMessages] Failed to parse buffered message from Redis (${key}): ${parseError}. Raw: ${msgString.substring(0,100)}...`);
                parseErrorCount++;
            }
        }

        logger.info(`[sendBufferedMessages] Processing ${messagesToSend.length} valid, non-expired messages for ${key} (Expired: ${expiredCount}, Parse Errors: ${parseErrorCount})`);

        for (const msgData of messagesToSend) {
            logger.debug(`[sendBufferedMessages] Sending buffered message type ${msgData.type} to user ${ws.userId} for topic ${topic}`);
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(msgData));
                    sentCount++;
                } catch (sendError) {
                    logger.error(`[sendBufferedMessages] Error sending buffered message type ${msgData.type} to ${ws.userId}: ${sendError}`);
                    skippedCount++;
                }
            } else {
                skippedCount++;
                logger.warn(`[sendBufferedMessages] Client ${ws.userId} readyState is ${ws.readyState} while sending buffered messages. Skipping message type ${msgData.type}.`);
                if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                    logger.warn(`[sendBufferedMessages] Client ${ws.userId} connection closed while sending buffered messages. Stopping delivery for this client.`);
                    break;
                }
            }
        }

        if (messagesToSend.length > 0 || expiredCount > 0 || parseErrorCount > 0) {
            logger.info(`[sendBufferedMessages] Attempting to clear Redis buffer ${key} after processing.`);
            try {
                await redisClient.del(key);
                logger.info(`[sendBufferedMessages] Successfully cleared Redis buffer ${key}.`);
            } catch (delError) {
                logger.error(`[sendBufferedMessages] Failed to clear Redis buffer ${key}: ${delError}`);
            }
        } else {
            logger.info(`[sendBufferedMessages] No messages processed, expired, or failed parsing for ${key}. Buffer not cleared.`);
        }

        logger.info(`[sendBufferedMessages] Delivery report for ${key}: Sent: ${sentCount}, Skipped(Closed/Error): ${skippedCount}, Expired: ${expiredCount}, Parse Errors: ${parseErrorCount}, Total Raw: ${messages.length}`);

    } catch (redisError) {
        logger.error(`[sendBufferedMessages] Redis error fetching/processing buffered messages for ${key}: ${redisError}`);
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