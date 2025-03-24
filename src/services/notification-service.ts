// src/services/notification-service.ts
import { logger } from '@/utils/logger';
import { websocketManager } from '@/utils/websocket';

export type NotificationType = 
  | 'conversation_started'
  | 'conversation_completed'
  | 'audio_uploaded'
  | 'subscription_updated';

export const sendNotification = (
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown>
): void => {
  try {
    websocketManager.sendToUser(userId, {
      type,
      timestamp: new Date().toISOString(),
      payload
    });
    
    logger.debug(`Sent notification of type ${type} to user ${userId}`);
  } catch (error) {
    logger.error(`Failed to send notification: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const sendConversationNotification = (
  userId: string,
  conversationId: string,
  type: 'conversation_started' | 'conversation_completed',
  details?: Record<string, unknown>
): void => {
  sendNotification(userId, type, {
    conversationId,
    ...details
  });
};

export const sendAudioNotification = (
  userId: string,
  audioId: number,
  conversationId: string,
  status: string
): void => {
  sendNotification(userId, 'audio_uploaded', {
    audioId,
    conversationId,
    status
  });
};

export const sendSubscriptionNotification = (
  userId: string,
  isActive: boolean,
  expiresDate?: number | null
): void => {
  sendNotification(userId, 'subscription_updated', {
    isActive,
    expiresDate
  });
};