import type { Result } from '@/types/common';
import { verifyAppleToken } from '../apple-auth';
import { cacheAppleAuthResult, getCachedAppleAuth } from '../apple-auth-cache';
import { log } from '../logger';
import { addClientToUser, getClientsByUserId, getWss, type WebSocketClient } from './state';

export const AUTH_TIMEOUT_MS = 10 * 1000; // 10 seconds

// Base interface for type checking
interface BaseWebSocketIncomingMessage {
    type: string;
    [key: string]: unknown; // Allow other properties
}

interface AuthMessage extends BaseWebSocketIncomingMessage {
    type: 'auth';
    token: string;
}

function isAuthMessage(data: unknown): data is AuthMessage {
    // Check if it's an object and has the required fields with correct types
    const message = data as BaseWebSocketIncomingMessage;
    return (
        typeof message === 'object' &&
        message !== null &&
        message.type === 'auth' &&
        typeof message.token === 'string' && message.token.length > 0
    );
}

async function performAuthentication(token: string, clientIp: string): Promise<Result<{ userId: string }, Error>> {
    let result: Result<{ userId: string }, Error> | undefined;

    // 1. Check cache
    const cachedResult = await getCachedAppleAuth(token);
    if (cachedResult) {
        log.debug(`Using cached auth for client (IP: ${clientIp})`);
        result = cachedResult;
    } else {
        // 2. Verify with Apple if not cached
        log.debug(`Verifying token with Apple for client (IP: ${clientIp})`);
        const verificationResult = await verifyAppleToken(token);
        await cacheAppleAuthResult(token, verificationResult); // Cache the raw result
        result = verificationResult;
    }

    // 3. Ensure prefix is added before returning, regardless of source
    if (result?.success) {
        // Ensure the userId has the prefix
        const rawUserId = result.data.userId;
        const prefixedUserId = rawUserId.startsWith('apple:') ? rawUserId : `apple:${rawUserId}`;
        return { success: true, data: { userId: prefixedUserId } };
    } else if (result) {
        // Return failure result as is
        return result;
    } else {
        // Should not happen if cache/verify always return a result, but handle defensively
        log.error('performAuthentication failed to get a result from cache or verification');
        return { success: false, error: new Error('Authentication process failed internally') };
    }
}

export async function handleAuthMessage(
    ws: WebSocketClient,
    data: unknown,
    authTimeout: NodeJS.Timeout, // Correct type
    clientIp: string
): Promise<boolean> { // Returns true if authentication succeeded, false otherwise
    clearTimeout(authTimeout); // Clear timeout as we received a message

    if (!isAuthMessage(data)) {
        // Use the base interface type for logging unknown types
        const unknownType = (data as BaseWebSocketIncomingMessage)?.type || 'unknown';
        log.warn(`Received invalid/unexpected message during authentication phase from client (IP: ${clientIp}). Type: ${String(unknownType)}. Closing.`);
        ws.close(4002, 'Invalid or unexpected authentication message');
        return false;
    }

    const authResult = await performAuthentication(data.token, clientIp);

    if (authResult.success) {
        const authenticatedUserId = authResult.data.userId;
        ws.userId = authenticatedUserId;
        ws.isAuthenticating = false;

        addClientToUser(authenticatedUserId, ws);
        // Get client count from the WebSocketServer instance via getWss()
        const wssInstance = getWss();
        const userClientSet = getClientsByUserId().get(authenticatedUserId);
        const userConnectionCount = userClientSet?.size ?? 0; // Count for THIS user
        const totalServerConnections = wssInstance?.clients.size ?? 0; // Total server connections

        log.info(`WebSocket client authenticated: ${authenticatedUserId} (IP: ${clientIp}), user connections: ${userConnectionCount}, total server connections: ${totalServerConnections}`);

        ws.send(JSON.stringify({ type: 'auth_success', userId: authenticatedUserId, timestamp: new Date().toISOString() }));
        ws.send(JSON.stringify({
            type: 'connected',
            timestamp: new Date().toISOString(),
            payload: {
                message: 'Authenticated and connected to WebSocket server',
                serverTime: new Date().toISOString(),
                connectionId: `${authenticatedUserId}-${Math.random().toString(36).substring(2, 9)}`
            },
        }));
        return true;
    } else {
        log.warn(`WebSocket authentication failed for client (IP: ${clientIp}): ${authResult.error?.message || 'Unknown error during verification'}`);
        ws.close(4001, 'Authentication failed');
        return false;
    }
}