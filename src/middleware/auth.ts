import { clerkMiddleware, type ExpressRequestWithAuth } from '@clerk/express';

export const requireAuth = clerkMiddleware({
  secretKey: process.env.CLERK_SECRET_KEY ?? '',
})

export const getUserId = (req: ExpressRequestWithAuth): string | null => req.auth?.userId ?? null