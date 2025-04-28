/**
 * Higher-order function that wraps Express route handlers to automatically handle async errors
 */

import type { NextFunction, Request, Response } from 'express';
import { log } from './logger';

// Define a type for route handlers to improve type safety
type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<undefined | unknown>;

/**
 * Wraps an async route handler function to automatically catch and forward errors to Express error middleware
 * @param handler Async function that handles a route
 * @returns An Express-compatible route handler with error handling
 */
export const asyncHandler = (handler: AsyncRouteHandler) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next);
    } catch (error) {
      // Log the error here for centralized error tracking
      log.error("Unhandled error in route handler", { error: error instanceof Error ? error.message : String(error) });
      next(error);
    }
  };
};