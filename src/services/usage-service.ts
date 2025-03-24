import { config } from '@/config';
import { query } from '@/database';
import { hasActiveSubscription } from '@/services/subscription-serivice';
import { logger } from '@/utils/logger';

/**
 * Get the start date of the current month (UTC)
 */
const getCurrentMonthStart = (): number => {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Math.floor(startOfMonth.getTime() / 1000);
};

/**
 * Count conversations created by a user in the current month
 */
export const countUserConversationsThisMonth = async (userId: string): Promise<number> => {
  const monthStart = getCurrentMonthStart();
  
  const result = await query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM conversations
     WHERE userId = ? AND createdAt >= ?`,
    [userId, monthStart]
  );
  
  return result[0]?.count || 0;
};

/**
 * Check if a user can create a new conversation
 */
export const canCreateConversation = async (userId: string): Promise<{
  canCreate: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  isSubscribed: boolean;
}> => {
  try {
    // Check if user has an active subscription
    const subscriptionStatus = await hasActiveSubscription(userId);
    
    // Subscribers have unlimited access
    if (subscriptionStatus.isActive) {
      return {
        canCreate: true,
        currentUsage: 0,
        limit: -1, // Unlimited
        isSubscribed: true
      };
    }
    
    // For free tier users, check current usage
    const conversationCount = await countUserConversationsThisMonth(userId);
    const canCreate = conversationCount < config.freeTier.monthlyConversationLimit;
    
    return {
      canCreate,
      reason: canCreate ? undefined : 'Monthly conversation limit reached',
      currentUsage: conversationCount,
      limit: config.freeTier.monthlyConversationLimit,
      isSubscribed: false
    };
  } catch (error) {
    logger.error(`Error checking if user can create conversation: ${error instanceof Error ? error.message : String(error)}`);
    
    // Default to allowing creation if there's an error (business decision)
    return {
      canCreate: true,
      reason: 'Error checking limits',
      currentUsage: 0,
      limit: config.freeTier.monthlyConversationLimit,
      isSubscribed: false
    };
  }
};

/**
 * Get user's current usage stats
 */
export const getUserUsageStats = async (userId: string): Promise<{
  currentUsage: number;
  limit: number;
  isSubscribed: boolean;
  remainingConversations: number;
  resetDate: number;
}> => {
  try {
    const subscriptionStatus = await hasActiveSubscription(userId);
    
    // For subscribers, return unlimited usage info
    if (subscriptionStatus.isActive) {
      return {
        currentUsage: 0,
        limit: -1, // Unlimited
        isSubscribed: true,
        remainingConversations: -1, // Unlimited
        resetDate: 0 // Not applicable
      };
    }
    
    // For free tier users, calculate remaining conversations
    const conversationCount = await countUserConversationsThisMonth(userId);
    const remainingConversations = Math.max(0, config.freeTier.monthlyConversationLimit - conversationCount);
    
    // Calculate next reset date (1st of next month)
    const now = new Date();
    const resetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    
    return {
      currentUsage: conversationCount,
      limit: config.freeTier.monthlyConversationLimit,
      isSubscribed: false,
      remainingConversations,
      resetDate: Math.floor(resetDate.getTime() / 1000)
    };
  } catch (error) {
    logger.error(`Error getting user usage stats: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};