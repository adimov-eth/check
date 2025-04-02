/**
 * Re-exports the public API for the WebSocket module.
 */
export { handleUpgrade, initialize, shutdown } from './core';
export { broadcast, sendToSubscribedClients, sendToUser } from './messaging';
export type { WebSocketClient } from './state'; // Export type if needed elsewhere

