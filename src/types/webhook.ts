import type { WebhookEvent } from '@clerk/backend';

export type WebhookEventType = 
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'session.created'
  | 'session.ended'
  | 'session.removed';

export interface WebhookRequest {
  headers: {
    'svix-id'?: string;
    'svix-timestamp'?: string;
    'svix-signature'?: string;
  };
  body: WebhookEvent;
}

export interface WebhookResponse {
  success: boolean;
  message?: string;
  error?: string;
} 