import type { WebSocket, WebSocketServer } from 'ws';

// Interface for our WebSocket client, extending ws.WebSocket
export interface WebSocketClient extends WebSocket {
  userId?: string; // Optional during authentication phase, required after
  isAlive: boolean;
  subscribedTopics: Set<string>;
  isAuthenticating: boolean; // Flag to track authentication status
}

// Module-level state
let wss: WebSocketServer | null = null;
const clientsByUserId = new Map<string, Set<WebSocketClient>>();
let pingInterval: NodeJS.Timer | null = null;

export const getWss = (): WebSocketServer | null => wss;
export const setWss = (server: WebSocketServer | null): void => { wss = server; };

export const getClientsByUserId = (): Map<string, Set<WebSocketClient>> => clientsByUserId;

export const getPingInterval = (): NodeJS.Timer | null => pingInterval;
export const setPingInterval = (interval: NodeJS.Timer | null): void => { pingInterval = interval; };

export const addClientToUser = (userId: string, client: WebSocketClient): void => {
    if (!clientsByUserId.has(userId)) {
        clientsByUserId.set(userId, new Set());
    }
    clientsByUserId.get(userId)?.add(client);
};

export const removeClientFromUser = (userId: string, client: WebSocketClient): number => {
    const userClientSet = clientsByUserId.get(userId);
    if (userClientSet) {
        userClientSet.delete(client);
        const remainingCount = userClientSet.size;
        if (remainingCount === 0) {
            clientsByUserId.delete(userId);
        }
        return remainingCount;
    }
    return 0;
};

export const clearAllClients = (): void => {
    clientsByUserId.clear();
};