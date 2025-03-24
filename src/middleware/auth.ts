import { clerkMiddleware } from '@clerk/express';
import type { Request } from 'express';

export const requireAuth = clerkMiddleware({
  secretKey: process.env.CLERK_SECRET_KEY ?? '',
})

export const getUserId = (req: Request): string | null => req.auth?.userId ?? null