import { config } from '@/config';
import { query } from '@/database';
import { hasActiveSubscription } from '@/services/subscription-serivice';
import { logger } from '@/utils/logger';

/**
 * Get the start date of the current week (UTC)
 */
const getCurrentWeekStart = (): number => {
  const now = new Date();
  // Get the day of the week (0-6, where 0 is Sunday)
  const dayOfWeek = now.getUTCDay();
  // Subtract days to get to the start of the week (Sunday)
  const startOfWeek = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - dayOfWeek
  ));
  return Math.floor(startOfWeek.getTime() / 1000);
};

/**
 * Count conversations created by a user in the current week
 */
export const countUserConversationsThisWeek = async (userId: string): Promise<number> => {
  const weekStart = getCurrentWeekStart();
  
  const result = await query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM conversations
     WHERE userId = ? AND createdAt >= ?`,
    [userId, weekStart]
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
    const conversationCount = await countUserConversationsThisWeek(userId);
    const canCreate = conversationCount < config.freeTier.weeklyConversationLimit;
    
    return {
      canCreate,
      reason: canCreate ? undefined : 'Weekly conversation limit reached',
      currentUsage: conversationCount,
      limit: config.freeTier.weeklyConversationLimit,
      isSubscribed: false
    };
  } catch (error) {
    logger.error(`Error checking if user can create conversation: ${error instanceof Error ? error.message : String(error)}`);
    
    // Default to allowing creation if there's an error (business decision)
    return {
      canCreate: true,
      reason: 'Error checking limits',
      currentUsage: 0,
      limit: config.freeTier.weeklyConversationLimit,
      isSubscribed: false
    };
  }
};

/**
 * Calculate next reset date (start of next week)
 */
const getNextResetDate = (): number => {
  const now = new Date();
  const daysUntilNextWeek = 7 - now.getUTCDay();
  const resetDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilNextWeek
  ));
  return Math.floor(resetDate.getTime() / 1000);
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
    const nextResetDate = getNextResetDate();
    
    // For subscribers, return unlimited usage info but with next reset date
    if (subscriptionStatus.isActive) {
      return {
        currentUsage: 0,
        limit: -1, // Unlimited
        isSubscribed: true,
        remainingConversations: -1, // Unlimited
        resetDate: nextResetDate // Show next week's reset date even for subscribers
      };
    }
    
    // For free tier users, calculate remaining conversations
    const conversationCount = await countUserConversationsThisWeek(userId);
    const remainingConversations = Math.max(0, config.freeTier.weeklyConversationLimit - conversationCount);
    
    return {
      currentUsage: conversationCount,
      limit: config.freeTier.weeklyConversationLimit,
      isSubscribed: false,
      remainingConversations,
      resetDate: nextResetDate
    };
  } catch (error) {
    logger.error(`Error getting user usage stats: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};