// User entity
export interface User {
    id: string;
    email: string;
    name?: string;
    createdAt: number;
    updatedAt: number;
  }
  
  // Conversation entity
  export interface Conversation {
    id: string;
    userId: string;
    mode: string;
    recordingType: 'separate' | 'live';
    status: 'waiting' | 'processing' | 'completed' | 'failed';
    gptResponse?: string;
    errorMessage?: string;
    createdAt: number;
    updatedAt: number;
  }
  
  // Audio entity
  export interface Audio {
    id: number;
    conversationId: string;
    userId: string;
    audioFile?: string;
    transcription?: string;
    status: 'uploaded' | 'processing' | 'transcribed' | 'failed';
    errorMessage?: string;
    createdAt: number;
    updatedAt: number;
  }
  
  // Subscription entity (Updated to match v2 migration schema)
  export interface Subscription {
    id: string; // Primary key (usually originalTransactionId)
    userId: string;
    originalTransactionId: string; // Unique identifier from Apple
    productId: string;
    status: string; // e.g., 'active', 'expired', 'grace_period', 'revoked', 'cancelled'
    environment: 'Sandbox' | 'Production';
    expiresDate: number | null; // Unix timestamp (seconds), nullable
    purchaseDate: number; // Unix timestamp (seconds)
    lastTransactionId: string;
    lastTransactionInfo: string | null; // JSON string of the last transaction payload
    lastRenewalInfo: string | null; // JSON string of the last renewal payload
    appAccountToken: string | null; // UUID if provided during purchase
    subscriptionGroupIdentifier: string | null;
    offerType: number | null; // e.g., 1: Intro, 2: Promo, 3: Offer Code
    offerIdentifier: string | null;
    createdAt: number; // Unix timestamp (seconds)
    updatedAt: number; // Unix timestamp (seconds)
  }
  
  // Job payload types
  export interface AudioJob {
    audioId: number;
    conversationId: string;
    audioPath: string;
    userId: string;
  }
  
  export interface GptJob {
    conversationId: string;
    userId: string;
  }
  
  export interface EmailJob {
    userId: string;
    email: string;
  }
