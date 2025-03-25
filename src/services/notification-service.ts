// src/services/notification-service.ts
import { logger } from '@/utils/logger';
import { websocketManager } from '@/utils/websocket';

export const sendTranscriptNotification = (
  userId: string,
  conversationId: string,
  content: string
): void => {
  const topic = `conversation:${conversationId}`;
  websocketManager.sendToSubscribedClients(userId, topic, {
    type: 'transcript',
    timestamp: new Date().toISOString(),
    payload: { conversationId, content },
  });
  logger.debug(`Sent transcript for conversation ${conversationId} to user ${userId}`);
};

export const sendAnalysisNotification = (
  userId: string,
  conversationId: string,
  content: string
): void => {
  const topic = `conversation:${conversationId}`;
  websocketManager.sendToSubscribedClients(userId, topic, {
    type: 'analysis',
    timestamp: new Date().toISOString(),
    payload: { conversationId, content },
  });
  logger.debug(`Sent analysis for conversation ${conversationId} to user ${userId}`);
};

export const sendStatusNotification = (
  userId: string,
  conversationId: string,
  status: 'processing' | 'completed' | 'error',
  error?: string
): void => {
  const topic = `conversation:${conversationId}`;
  websocketManager.sendToSubscribedClients(userId, topic, {
    type: 'status',
    timestamp: new Date().toISOString(),
    payload: { conversationId, status, ...(error && { error }) },
  });
  logger.debug(`Sent status ${status} for conversation ${conversationId} to user ${userId}`);
};