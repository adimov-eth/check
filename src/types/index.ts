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
  
  // Subscription entity
  export interface Subscription {
    id: number;
    userId: string;
    productId: string;
    type: string;
    originalTransactionId: string;
    transactionId: string;
    receiptData: string;
    environment: string;
    isActive: boolean;
    expiresDate?: number;
    purchaseDate: number;
    lastVerifiedDate: number;
    createdAt: number;
    updatedAt: number;
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
