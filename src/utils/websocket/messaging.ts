// /Users/adimov/Developer/final/check/src/utils/websocket/messaging.ts
import { redisClient } from "@/config";
import type { WebSocketMessage } from "@/types/websocket";
import { WebSocket } from "ws";
import { log } from "../logger";
import { type WebSocketClient, getClientsByUserId, getWss } from "./state";

const MESSAGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const BUFFER_MAX_LENGTH = 50; // Keep last 50 messages
const BUFFER_EXPIRY_SECONDS = 86400; // 1 day

// --- Buffering Logic ---

export async function sendBufferedMessages(
	ws: WebSocketClient,
	topic: string,
): Promise<void> {
	if (!ws.userId) {
		log.warn("Attempted to send buffered messages to unauthenticated client.");
		return;
	}
	const key = `ws:buffer:${ws.userId}:${topic}`;
	log.info(
		`[sendBufferedMessages] User ${ws.userId} checking Redis buffer: ${key}`,
	);

	try {
		const messages = await redisClient.lRange(key, 0, -1);
		if (messages.length === 0) {
			log.info(
				`[sendBufferedMessages] No buffered messages found in Redis for ${key}`,
			);
			return;
		}

		log.info(
			`[sendBufferedMessages] Found ${messages.length} raw messages in Redis for ${key}. Processing...`,
		);

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
					log.warn(
						`[sendBufferedMessages] Parsed message from ${key} is missing 'data' or 'timestamp'. Skipping.`,
					);
					parseErrorCount++;
					continue;
				}
				if (now - msg.timestamp < MESSAGE_EXPIRY_MS) {
					messagesToSend.push(msg.data as WebSocketMessage);
				} else {
					expiredCount++;
				}
			} catch (parseError) {
				log.error(
					`[sendBufferedMessages] Failed to parse buffered message from Redis (${key}): ${parseError}. Raw: ${msgString.substring(0, 100)}...`,
				);
				parseErrorCount++;
			}
		}

		log.info(
			`[sendBufferedMessages] Processing ${messagesToSend.length} valid, non-expired messages for ${key} (Expired: ${expiredCount}, Parse Errors: ${parseErrorCount})`,
		);

		for (const msgData of messagesToSend) {
			log.debug(
				`[sendBufferedMessages] Sending buffered message type ${msgData.type} to user ${ws.userId} for topic ${topic}`,
			);
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(JSON.stringify(msgData));
					sentCount++;
				} catch (sendError) {
					log.error(
						`[sendBufferedMessages] Error sending buffered message type ${msgData.type} to ${ws.userId}: ${sendError}`,
					);
					skippedCount++;
				}
			} else {
				skippedCount++;
				log.warn(
					`[sendBufferedMessages] Client ${ws.userId} readyState is ${ws.readyState} while sending buffered messages. Skipping message type ${msgData.type}.`,
				);
				if (
					ws.readyState === WebSocket.CLOSED ||
					ws.readyState === WebSocket.CLOSING
				) {
					log.warn(
						`[sendBufferedMessages] Client ${ws.userId} connection closed while sending buffered messages. Stopping delivery for this client.`,
					);
					break; // Stop trying to send to this closed client
				}
			}
		}

		// --- MODIFICATION: Clear buffer ONLY if messages were successfully sent ---
		// This prevents clearing the buffer if the client disconnected mid-send.
		if (sentCount > 0 && sentCount === messagesToSend.length) {
			// Clear only if ALL intended messages were sent
			log.info(
				`[sendBufferedMessages] Attempting to clear Redis buffer ${key} after sending ${sentCount} messages.`,
			);
			try {
				log.debug(`[sendBufferedMessages] Executing redisClient.del(${key})`);
				await redisClient.del(key);
				log.info(
					`[sendBufferedMessages] Successfully cleared Redis buffer ${key}.`,
				);
			} catch (delError) {
				log.error(
					`[sendBufferedMessages] Failed to clear Redis buffer ${key}: ${delError}`,
				);
			}
		} else if (messagesToSend.length > 0) {
			log.warn(
				`[sendBufferedMessages] Not all messages successfully sent for ${key} (Sent: ${sentCount}/${messagesToSend.length}), buffer not cleared.`,
			);
		} else if (expiredCount > 0 || parseErrorCount > 0) {
			// If only expired/error messages were found, clear the buffer
			log.info(
				`[sendBufferedMessages] Clearing Redis buffer ${key} containing only expired/invalid messages.`,
			);
			try {
				await redisClient.del(key);
				log.info(
					`[sendBufferedMessages] Successfully cleared Redis buffer ${key}.`,
				);
			} catch (delError) {
				log.error(
					`[sendBufferedMessages] Failed to clear Redis buffer ${key}: ${delError}`,
				);
			}
		}
		// --- END MODIFICATION ---

		log.info(
			`[sendBufferedMessages] Delivery report for ${key}: Sent: ${sentCount}, Skipped(Closed/Error): ${skippedCount}, Expired: ${expiredCount}, Parse Errors: ${parseErrorCount}, Total Raw: ${messages.length}`,
		);
	} catch (redisError) {
		log.error(
			`[sendBufferedMessages] Redis error fetching/processing buffered messages for ${key}: ${redisError}`,
		);
	}
}

export async function bufferMessage(
	userId: string,
	topic: string,
	data: WebSocketMessage,
): Promise<void> {
	const messageData = {
		...data,
		timestamp: data.timestamp || new Date().toISOString(), // Ensure timestamp exists
	};
	const key = `ws:buffer:${userId}:${topic}`;
	// Store the message data along with a current timestamp for expiry check
	const messageToStore = JSON.stringify({
		data: messageData,
		timestamp: Date.now(),
	});

	try {
		await redisClient.rPush(key, messageToStore);
		await redisClient.lTrim(key, -BUFFER_MAX_LENGTH, -1); // Keep only the last N messages
		await redisClient.expire(key, BUFFER_EXPIRY_SECONDS); // Set expiry for the list
		const listLength = (await redisClient.lLen(key)) || 0;
		log.debug(
			`Buffered message for user ${userId}, topic ${topic}. Redis list size: ${listLength}`,
		);
	} catch (redisError) {
		log.error(`Redis error buffering message for ${key}: ${redisError}`);
	}
}

// --- Sending Logic ---

export function sendToUser(userId: string, data: WebSocketMessage): void {
	const userClients = getClientsByUserId().get(userId);
	if (!userClients || userClients.size === 0) {
		log.debug(
			`No active clients for user ${userId}, cannot send message directly.`,
		);
		// Note: Messages sent directly via sendToUser are generally not buffered.
		// Buffering is primarily for subscription-based messages.
		return;
	}

	const message = JSON.stringify(data);
	let sentCount = 0;

	for (const client of userClients) {
		if (
			client.userId === userId &&
			!client.isAuthenticating &&
			client.readyState === WebSocket.OPEN
		) {
			try {
				client.send(message);
				sentCount++;
			} catch (error) {
				log.error(
					`Error sending direct message to user ${userId} (client instance): ${error}`,
				);
				// Optionally: Handle client termination on send error
				// client.terminate();
			}
		}
	}
	log.debug(
		`Sent direct message to ${sentCount}/${userClients.size} clients for user ${userId}`,
	);
}

export function sendToSubscribedClients(
	userId: string,
	topic: string,
	data: WebSocketMessage,
): void {
	const userClients = getClientsByUserId().get(userId);
	log.debug(`Attempting to send message to topic ${topic} for user ${userId}`);

	let shouldBuffer = false;
	if (!userClients || userClients.size === 0) {
		log.warn(
			`No connected clients found for user ${userId}. Buffering message for topic ${topic}.`,
		);
		shouldBuffer = true;
	}

	const message = JSON.stringify(data);
	let sentCount = 0;
	let notSubscribedCount = 0;
	let closedCount = 0;
	let notAuthCount = 0;
	let errorCount = 0;

	if (userClients) {
		// Only iterate if clients exist
		for (const client of userClients) {
			if (
				!client.userId ||
				client.userId !== userId ||
				client.isAuthenticating
			) {
				notAuthCount++;
				return;
			}

			if (client.readyState === WebSocket.OPEN) {
				if (client.subscribedTopics.has(topic)) {
					try {
						client.send(message);
						sentCount++;
						log.debug(
							`Message sent to client ${client.userId} subscribed to ${topic}`,
						);
					} catch (error) {
						log.error(
							`Error sending message to client ${client.userId} for topic ${topic}: ${error}`,
						);
						errorCount++;
						// Optionally terminate client on send error
						// client.terminate();
					}
				} else {
					notSubscribedCount++;
					log.debug(
						`Client ${client.userId} is connected but not subscribed to ${topic}.`,
					);
				}
			} else {
				closedCount++;
			}
		}
	}

	// --- MODIFICATION: Refined buffering condition ---
	// Buffer if no clients successfully received the message AND there were clients for the user OR if there were no clients at all.
	if (
		sentCount === 0 &&
		((userClients && userClients.size > 0) || !userClients)
	) {
		// Log why buffering is happening
		if (userClients && userClients.size > 0) {
			log.warn(
				`Message for topic ${topic} not sent to any active, subscribed, open clients for user ${userId}. Buffering.`,
			);
		} // Logging for no clients is handled above
		shouldBuffer = true;
	}
	// --- END MODIFICATION ---

	if (shouldBuffer) {
		bufferMessage(userId, topic, data);
	}

	log.debug(
		`Message delivery report for user ${userId}, topic ${topic}: sent=${sentCount}, not_subscribed=${notSubscribedCount}, closed=${closedCount}, not_auth=${notAuthCount}, errors=${errorCount}, total_clients=${userClients?.size ?? 0}, buffered=${shouldBuffer}`,
	);
}

export function broadcast(data: WebSocketMessage): void {
	const wss = getWss();
	if (!wss) {
		log.warn(
			"Attempted to broadcast message but WebSocket server is not initialized",
		);
		return;
	}

	const message = JSON.stringify(data);
	let sentCount = 0;
	let totalClients = 0;
	let errorCount = 0;

	for (const client of wss.clients) {
		totalClients++;
		const wsClient = client as WebSocketClient; // Assuming all clients are WebSocketClient
		if (
			wsClient.userId &&
			!wsClient.isAuthenticating &&
			wsClient.readyState === WebSocket.OPEN
		) {
			try {
				wsClient.send(message);
				sentCount++;
			} catch (error) {
				log.error(
					`Error broadcasting message to client ${wsClient.userId}: ${error}`,
				);
				errorCount++;
				// Optionally terminate client on send error
				// wsClient.terminate();
			}
		}
	}

	log.debug(
		`Broadcast message: Sent to ${sentCount} authenticated clients. Errors: ${errorCount}. Total connected: ${totalClients}.`,
	);
}
