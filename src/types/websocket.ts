// src/types/websocket.ts
import type { WebSocket } from 'ws';

export type MessageType = 
  | 'transcript'
  | 'analysis'
  | 'error'
  | 'status'
  | 'connected'
  | 'subscription_confirmed'
  | 'unsubscription_confirmed'
  | 'ping'
  | 'pong'
  | 'audio'
  | 'subscribe'
  | 'unsubscribe';

export interface BaseWebSocketIncomingMessage {
  type: MessageType;
  payload?: WebSocketPayload;
}

export interface WebSocketMessage {
  type: MessageType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface WebSocketClientOptions {
  token: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  version?: string;
}

export interface AuthenticatedWebSocket extends WebSocket {
  userId: string;
  subscribedTopics?: Set<string>;
  isAlive?: boolean;
  lastPing?: number;
}

// Define payload types for type safety
export interface WebSocketPayload {
  topic?: string;
  content?: string;
  error?: string;
  status?: string;
  conversationId?: string;
  audioId?: string;
  [key: string]: unknown;
}

export interface TranscriptPayload extends WebSocketPayload {
  conversationId: string;
  content: string;
}

export interface AnalysisPayload extends WebSocketPayload {
  conversationId: string;
  content: string;
}

export interface StatusPayload extends WebSocketPayload {
  conversationId: string;
  status: string;
  error?: string;
  gptResponse?: string;
}

export interface AudioStatusPayload extends WebSocketPayload {
  audioId: string;
  status: 'processing' | 'transcribed' | 'failed';
}

// Helper class for creating WebSocket messages
export class WebSocketMessageFactory {
  static error(message: string): string {
    return JSON.stringify({
      type: 'error' as MessageType,
      timestamp: new Date().toISOString(),
      payload: { error: message }
    });
  }

  static subscriptionConfirmed(topic: string): string {
    return JSON.stringify({
      type: 'subscription_confirmed' as MessageType,
      timestamp: new Date().toISOString(),
      payload: { topic }
    });
  }

  static unsubscriptionConfirmed(topic: string): string {
    return JSON.stringify({
      type: 'unsubscription_confirmed' as MessageType,
      timestamp: new Date().toISOString(),
      payload: { topic }
    });
  }

  static pong(): string {
    return JSON.stringify({
      type: 'pong' as MessageType,
      timestamp: new Date().toISOString(),
      payload: {}
    });
  }
}