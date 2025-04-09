import { notificationQueue } from '@/queues';
import { log } from '@/utils/logger';

export const sendTranscriptNotification = async (
  userId: string,
  conversationId: string,
  content: string
): Promise<void> => {
  const topic = `conversation:${conversationId}`;
  await notificationQueue.add('transcript', {
    type: 'transcript',
    userId,
    topic,
    payload: { conversationId, content },
    timestamp: new Date().toISOString()
  });
  log.debug(`Queued transcript notification`, { conversationId, userId });
};

export const sendAnalysisNotification = async (
  userId: string,
  conversationId: string,
  content: string
): Promise<void> => {
  const topic = `conversation:${conversationId}`;
  await notificationQueue.add('analysis', {
    type: 'analysis',
    userId,
    topic,
    payload: { conversationId, content },
    timestamp: new Date().toISOString()
  });
  log.debug(`Queued analysis notification`, { conversationId, userId });
};

export const sendStatusNotification = async (
  userId: string,
  conversationId: string,
  status: 'processing' | 'completed' | 'error',
  error?: string
): Promise<void> => {
  const topic = `conversation:${conversationId}`;
  await notificationQueue.add('status', {
    type: 'status',
    userId,
    topic,
    payload: { conversationId, status, ...(error && { error }) },
    timestamp: new Date().toISOString()
  });
  log.debug(`Queued status notification`, { status, conversationId, userId });
};

export const sendConversationNotification = async (
  userId: string,
  conversationId: string,
  status: 'conversation_started' | 'conversation_completed',
  payload?: Record<string, unknown>
): Promise<void> => {
  const topic = `conversation:${conversationId}`;
  const timestamp = new Date().toISOString();

  if (status === 'conversation_completed') {
    // Queue status update
    await notificationQueue.add('status', {
      type: 'status',
      userId,
      topic,
      payload: { conversationId, status, ...payload },
      timestamp
    });
    // Queue analysis if gptResponse is available
    if (payload?.gptResponse) {
      await notificationQueue.add('analysis', {
        type: 'analysis',
        userId,
        topic,
        payload: { conversationId, content: payload.gptResponse as string },
        timestamp
      });
    }
    log.debug(`Queued conversation completed notifications`, { conversationId, userId });
  } else {
    // Queue status update for other statuses
    await notificationQueue.add('status', {
      type: 'status',
      userId,
      topic,
      payload: { conversationId, status, ...payload },
      timestamp
    });
    log.debug(`Queued conversation started notification`, { conversationId, userId });
  }
};

export const sendAudioNotification = async (
  userId: string,
  audioId: string,
  conversationId: string,
  status: 'processing' | 'transcribed' | 'failed'
): Promise<void> => {
  const topic = `conversation:${conversationId}`;
  await notificationQueue.add('audio', {
    type: 'audio',
    userId,
    topic,
    payload: { audioId, status, conversationId },
    timestamp: new Date().toISOString()
  });
  log.debug(`Queued audio notification`, { status, audioId, conversationId, userId });
};