// src/types/websocket.ts
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
  | 'audio';

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

// Define payload types for type safety
export interface TranscriptPayload {
  conversationId: string;
  content: string;
}

export interface AnalysisPayload {
  conversationId: string;
  content: string;
}

export interface StatusPayload {
  conversationId: string;
  status: string;
  error?: string;
  gptResponse?: string;
}

export interface AudioStatusPayload {
  audioId: string;
  status: 'processing' | 'transcribed' | 'failed';
}