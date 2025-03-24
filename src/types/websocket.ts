// src/types/websocket.ts
export interface WebSocketMessage {
    type: string;
    timestamp: string;
    payload: Record<string, unknown>;
  }
  
  export interface WebSocketClientOptions {
    token: string;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
  }