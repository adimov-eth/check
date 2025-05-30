import { config } from '@/config';
import { query } from '@/database';
import { hasActiveSubscription } from '@/services/subscription-serivice';
import { getCurrentWeekStart, getNextResetDate } from '@/utils/date-utils';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';

/**
 * Count conversations created by a user in the current week
 */
export const countUserConversationsThisWeek = async (userId: string): Promise<number> => {
  try {
    const weekStart = getCurrentWeekStart();
    
    // First check if the user exists
    const userResult = await query<{ user_exists: number }>(
      "SELECT 1 as user_exists FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    
    // If user doesn't exist in our database, they have 0 conversations
    if (!userResult[0] || !userResult[0].user_exists) {
      log.warn("Attempted to count conversations for non-existent user", { userId });
      return 0;
    }
    
    const result = await query<{ count: number }>(
      `SELECT COUNT(*) as count
      FROM conversations
      WHERE userId = ? AND createdAt >= ?`,
      [userId, weekStart]
    );
    
    return result[0]?.count || 0;
  } catch (error) {
    log.error("Error counting user conversations", { userId, error: formatError(error) });
    // Fall back to 0 to prevent usage tracking errors from blocking user actions
    return 0;
  }
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
    log.error("Error checking if user can create conversation", { userId, error: formatError(error) });
    
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
    log.error("Error getting user usage stats", { userId, error: formatError(error) });
    throw error;
  }
};