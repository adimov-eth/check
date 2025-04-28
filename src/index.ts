import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import type { Socket } from "node:net";
// src/index.ts
import { app } from "@/api";
import { config, redisClient } from "@/config";
// Use the correctly exported names from the websocket module
import { runMigrations } from "@/database/migrations"; // Import the migration runner
import { formatError } from "@/utils/error-formatter";
import { log } from "@/utils/logger";
import {
	handleUpgrade,
	initialize,
	sendToSubscribedClients,
	shutdown,
} from "@/utils/websocket";

const WEBSOCKET_NOTIFICATION_CHANNEL = "websocket-notifications";

// Initialize database schema and required directories
const startServer = async () => {
	let subscriber: typeof redisClient | null = null; // Keep track of subscriber for shutdown
	try {
		// 1. REMOVE Schema Initialization call (now handled by migrations)
		// await initSchema();

		// 2. Run Migrations (handles schema creation and updates)
		await runMigrations(); // This now includes initial schema setup

		// Initialize Redis Subscriber for WebSocket notifications
		subscriber = redisClient.duplicate();
		await subscriber.connect();
		log.info("Redis subscriber client connected for WebSocket notifications.");

		await subscriber.subscribe(
			WEBSOCKET_NOTIFICATION_CHANNEL,
			(message, channel) => {
				log.debug(`Received message from Redis channel '${channel}'`, {
					rawMessage: message,
				});
				try {
					const parsedMessage = JSON.parse(message);
					const { userId, topic, data } = parsedMessage;

					// Basic validation
					if (!userId || !topic || !data || !data.type) {
						log.warn("Received invalid message format from Redis pub/sub", {
							parsedMessage,
						});
						return;
					}

					// Call the local send function (which uses the main process's client map)
					sendToSubscribedClients(userId, topic, data);
					log.debug("Relayed notification via WebSocket", {
						userId,
						topic,
						type: data.type,
					});
				} catch (error) {
					log.error(
						`Error processing message from Redis channel '${channel}'`,
						{
							rawMessage: message,
							error: formatError(error),
						},
					);
				}
			},
		);
		log.info(`Subscribed to Redis channel: ${WEBSOCKET_NOTIFICATION_CHANNEL}`);

		// 3. Start your application server
		const server = createServer(app);
		// Initialize WebSocket server using the imported function
		initialize(server, "/ws"); // Pass the server instance and optional path

		server.on(
			"upgrade",
			(req: IncomingMessage, socket: Socket, head: Buffer) => {
				const url = new URL(req.url || "", `http://${req.headers.host}`);
				// Ensure the path matches the one used during initialization
				if (url.pathname !== "/ws") {
					log.debug(`Rejecting upgrade request for path: ${url.pathname}`);
					socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
					socket.destroy();
					return;
				}

				// Handle the upgrade using the imported function
				handleUpgrade(req, socket, head);
			},
		);

		server.listen(config.port, () => {
			log.info(
				`Server running on port ${config.port} in ${config.nodeEnv} mode`,
			);
			log.info(
				`WebSocket server accepting connections on ws://localhost:${config.port}/ws`,
			);
		});

		const gracefulShutdown = async (): Promise<void> => {
			log.info("Shutting down server...");

			// Shutdown WebSocket server first
			shutdown();

			// Unsubscribe and quit Redis subscriber
			if (subscriber?.isOpen) {
				try {
					await subscriber.unsubscribe(WEBSOCKET_NOTIFICATION_CHANNEL);
					await subscriber.quit();
					log.info("Redis subscriber client disconnected.");
				} catch (redisError) {
					log.error("Error disconnecting Redis subscriber client", {
						error: formatError(redisError),
					});
				}
			}

			// Allow some time for WS connections and Redis sub to close before closing HTTP
			await new Promise((resolve) => setTimeout(resolve, 2500)); // Adjust delay if needed

			server.close(async (err) => {
				if (err) {
					log.error(`Error closing HTTP server: ${err.message}`);
				} else {
					log.info("HTTP server closed");
				}

				// Disconnect Redis client (if applicable and managed here)
				// await redisClient.quit();
				// logger.info('Redis client disconnected.');

				log.info("Shutdown complete");
				process.exit(err ? 1 : 0);
			});

			// Force shutdown after timeout
			setTimeout(() => {
				log.error("Graceful shutdown timeout exceeded. Forcing exit.");
				process.exit(1);
			}, 10000); // 10 seconds total timeout
		};

		process.on("SIGTERM", gracefulShutdown);
		process.on("SIGINT", gracefulShutdown);
	} catch (error) {
		// Close subscriber if initialization failed
		if (subscriber?.isOpen) {
			try {
				await subscriber.quit();
			} catch (e) {
				log.error("Error closing Redis subscriber during failed startup", {
					error: formatError(e),
				});
			}
		}
		log.error("Server startup failed:", { error: formatError(error) });
		process.exit(1);
	}
};

startServer();
