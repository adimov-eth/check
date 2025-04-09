import type { BaseWebSocketIncomingMessage } from '@/types/websocket';
import { formatError } from '@/utils/error-formatter';
import type { IncomingMessage, Server } from 'http';
import type { Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { log } from '../logger';
import { AUTH_TIMEOUT_MS, handleAuthMessage } from './auth';
import { handleAuthenticatedMessage } from './handlers';
import {
    clearAllClients,
    getPingInterval,
    getWss,
    removeClientFromUser,
    setPingInterval,
    setWss,
    type WebSocketClient
} from './state';

const PING_INTERVAL_MS = 30000; // 30 seconds

// Helper to safely get client IP address
function getClientIp(req: IncomingMessage): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    let ip = req.socket.remoteAddress || 'unknown IP'; // Default to remoteAddress

    if (typeof forwardedFor === 'string') {
        ip = forwardedFor.split(',')[0].trim(); // Take the first IP if it's a comma-separated string
    } else if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
        ip = forwardedFor[0].trim(); // Take the first IP if it's an array
    }
    return ip;
}

// --- Core Initialization and Connection Handling ---

function setupClientListeners(ws: WebSocketClient, req: IncomingMessage, authTimeout: NodeJS.Timeout): void {
    const clientIp = getClientIp(req); // Use helper function

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', async (message) => {
        try {
            const rawMessage = message.toString();
            let parsedData: unknown;
            try {
                parsedData = JSON.parse(rawMessage);
            } catch (parseError) {
                log.warn(`Received invalid JSON from client (IP: ${clientIp}): ${formatError(parseError)}. Raw: ${rawMessage.substring(0, 100)}... Closing connection.`);
                 // No cast needed when clearing timeout
                 clearTimeout(authTimeout);
                ws.close(4000, "Invalid JSON message received");
                return;
            }

             // Check message format early
             if (typeof parsedData !== 'object' || parsedData === null) {
                log.warn(`Received non-object message from client (IP: ${clientIp}): ${rawMessage.substring(0, 100)}... Closing connection.`);
                 // No cast needed when clearing timeout
                 clearTimeout(authTimeout);
                ws.close(4000, "Invalid message format");
                return;
            }

            if (ws.isAuthenticating) {
                // Pass authTimeout (NodeJS.Timeout type is expected by handleAuthMessage)
                await handleAuthMessage(ws, parsedData, authTimeout, clientIp);
                // If authentication fails, handleAuthMessage closes the connection.
                // If it succeeds, isAuthenticating is set to false.
            } else {
                // Already authenticated, handle regular messages
                if (typeof parsedData === 'object' && parsedData !== null && 'type' in parsedData) {
                    handleAuthenticatedMessage(ws, parsedData as BaseWebSocketIncomingMessage);
                } else {
                    log.warn(`Invalid message format from authenticated client: missing 'type' property`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format', timestamp: new Date().toISOString() }));
                }
            }
        } catch (error) {
            log.error(`Error processing message from ${ws.userId || `unauthenticated client (${clientIp})`}: ${formatError(error)}`);
            if (ws.readyState === WebSocket.OPEN && !ws.isAuthenticating) {
                 try {
                     ws.send(JSON.stringify({ type: 'error', message: 'Failed to process your message', timestamp: new Date().toISOString() }));
                 } catch (sendError) {
                     log.error(`Failed to send error notification to client ${ws.userId}: ${formatError(sendError)}`);
                 }
            } else if (ws.isAuthenticating && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                 log.warn(`Closing connection due to error during authentication message processing for client (IP: ${clientIp})`);
                 // No cast needed when clearing timeout
                 clearTimeout(authTimeout);
                 ws.close(4000, "Error during authentication processing");
             }
             // Optionally close connection on any error if desired
             // ws.close(1011, "Internal Server Error");
        }
    });

    ws.on('close', (code, reason) => {
        // No cast needed when clearing timeout
        clearTimeout(authTimeout);
        const userId = ws.userId;
        const reasonString = reason.toString('utf-8') || 'No reason provided';

        if (userId) {
            const remainingCount = removeClientFromUser(userId, ws);
            log.info(`WebSocket client disconnected: ${userId} (IP: ${clientIp}), Code: ${code}, Reason: "${reasonString}". Remaining connections for user: ${remainingCount}`);
        } else {
            log.info(`Unauthenticated WebSocket client disconnected (IP: ${clientIp}), Code: ${code}, Reason: "${reasonString}"`);
        }
    });

    ws.on('error', (error) => {
         // No cast needed when clearing timeout
         clearTimeout(authTimeout);
        const userId = ws.userId;
        log.error(`WebSocket error for ${userId || `unauthenticated client (${clientIp})`}: ${error.message}`);
        // Attempt to remove client from map even on error
        if (userId) {
            removeClientFromUser(userId, ws);
        }
        // Ensure termination on error
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
            log.warn(`Terminating WebSocket due to error event for ${userId || `unauthenticated client (${clientIp})`}`);
            ws.terminate();
        }
    });
}

function setupConnectionListener(wss: WebSocketServer): void {
    wss.on('connection', (ws: WebSocketClient, req: IncomingMessage) => {
        const clientIp = getClientIp(req); // Use helper function
        log.info(`WebSocket client connected (IP: ${clientIp}) - awaiting authentication`);

        // Initialize client state (already done in handleUpgrade, but good practice here too)
        ws.isAlive = true;
        ws.isAuthenticating = true;
        ws.userId = undefined;
        ws.subscribedTopics = ws.subscribedTopics || new Set(); // Ensure set exists

        // Set authentication timeout - setTimeout returns NodeJS.Timeout
        const authTimeout = setTimeout(() => {
            if (ws.isAuthenticating && !ws.userId) { // Check if still authenticating and no userId assigned
                log.warn(`WebSocket client (IP: ${clientIp}) failed to authenticate within ${AUTH_TIMEOUT_MS}ms. Closing connection.`);
                ws.close(4008, 'Authentication timed out');
            }
        }, AUTH_TIMEOUT_MS);

        // Pass the NodeJS.Timeout handle - no cast needed
        setupClientListeners(ws, req, authTimeout as NodeJS.Timeout);
    });

    wss.on('error', (error) => {
        log.error(`WebSocketServer error: ${error.message}`);
        // Consider more robust error handling here, e.g., trying to restart
    });
}


function startPingInterval(): void {
    log.info(`Starting WebSocket ping interval (${PING_INTERVAL_MS}ms)`);
    const interval = setInterval(() => {
        const wss = getWss();
        if (!wss) {
             log.warn("Ping interval running but WSS is null.");
             return;
        }

        wss.clients.forEach((ws) => {
            const client = ws as WebSocketClient; // Assume all clients are WebSocketClient

            // Skip clients that are still authenticating
            if (client.isAuthenticating) {
                return;
            }

            // Check liveliness flag
            if (!client.isAlive) {
                log.warn(`Terminating inactive WebSocket for user ${client.userId || 'unknown (error before auth?)'}.`);
                return client.terminate(); // Use terminate for forceful closure
            }

            // Reset flag and send ping
            client.isAlive = false;
            try {
                client.ping(); // Send ping
            } catch (pingError) {
                log.error(`Error sending ping to client ${client.userId || 'unknown (error before auth?)'}: ${formatError(pingError)}. Terminating.`);
                client.terminate();
            }
        });
    }, PING_INTERVAL_MS);
    setPingInterval(interval);
}

function stopPingInterval(): void {
    const interval = getPingInterval();
    if (interval) {
        clearInterval(interval);
        setPingInterval(null);
        log.info('WebSocket ping interval stopped.');
    }
}

// --- Public API ---

export function initialize(server: Server, path = '/ws'): void {
    const currentWss = getWss();
    if (currentWss) {
        log.warn("WebSocket server already initialized. Shutting down existing instance before re-initializing.");
        shutdown(); // Ensure cleanup before re-initializing
    }

    const newWss = new WebSocketServer({ noServer: true });
    setWss(newWss);
    log.info(`WebSocket server instance created, path: ${path}`);

    setupConnectionListener(newWss);
    startPingInterval();
}

export function handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const wss = getWss();
    if (!wss) {
        log.error('WebSocket Server not initialized during handleUpgrade.');
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        const client = ws as WebSocketClient;
        // Initialize client state immediately on upgrade
        client.isAlive = true;
        client.subscribedTopics = new Set();
        client.isAuthenticating = true;
        client.userId = undefined;
        const clientIp = getClientIp(req); // Use helper
        log.debug(`WebSocket upgrade successful for IP: ${clientIp}`);
        wss.emit('connection', client, req); // Emit connection event for the listener
    });
}

export function shutdown(): void {
    log.info('Shutting down WebSocket Manager...');
    stopPingInterval();

    const wss = getWss();
    if (wss) {
        // Close connections gracefully first
        wss.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                try { ws.close(1001, 'Server shutting down'); } catch (e) { log.error(`Error closing client: ${formatError(e)}`); }
            }
        });

        // Terminate any remaining connections after a short delay
        const terminationTimeout = setTimeout(() => {
             log.warn("Forcibly terminating remaining WebSocket clients after shutdown delay.");
             wss.clients.forEach(ws => {
                  if (ws.readyState !== WebSocket.CLOSED) {
                     ws.terminate();
                  }
             });
        }, 2000); // 2-second grace period


        wss.close((err) => {
            clearTimeout(terminationTimeout); // Cancel termination if close completes quickly
            if (err) {
                log.error(`Error closing WebSocket Server: ${err.message}`);
            } else {
                log.info('WebSocket Server closed.');
            }
        });
        setWss(null);
    } else {
        log.info('WebSocket Server was not running.');
    }

    clearAllClients(); // Clear the client map
}