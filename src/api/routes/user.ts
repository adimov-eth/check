import { getUserId } from '@/middleware/auth'
import { AuthenticationError, NotFoundError } from '@/middleware/error'
import { getUserUsageStats } from '@/services/usage-service'
import { getUser } from '@/services/user-service'
import { logger } from '@/utils/logger'
import type { ExpressRequestWithAuth } from '@clerk/express'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'

const router = Router()

router.get('/me', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = getUserId(req as ExpressRequestWithAuth)
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found')
    }
    
    const [user, usageStats] = await Promise.all([
      getUser(userId),
      getUserUsageStats(userId)
    ])

    if (!user) {
      throw new NotFoundError(`User not found: ${userId}`)
    }
    
    logger.debug(`User data retrieved successfully: ${userId}`)
    res.json({
      ...user,
      usage: {
        currentUsage: usageStats.currentUsage,
        limit: usageStats.limit,
        isSubscribed: usageStats.isSubscribed,
        remainingConversations: usageStats.remainingConversations,
        resetDate: usageStats.resetDate
      }
    })
  } catch (error) {
    next(error) // Pass to error handler middleware
  }
})

export default router