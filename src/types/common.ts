// src/types/common.ts
import type { NextFunction, Request, Response } from 'express';

/**
 * Enhanced request object with authenticated user info
 */
export interface AuthenticatedRequest extends Request {
  userId: string;
  email?: string;
  fullName?: {
    givenName?: string;
    familyName?: string;
  };
  resource?: Resource; // Use the base Resource type here
}

/**
 * Type for request handler functions - Ensure it returns a Promise
 */
export type RequestHandler = (
  req: Request | AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>; // Changed return type to Promise<void>

/**
 * Type for middleware functions
 */
export type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * Resource access permissions (as const object)
 */
export const Permission = {
  READ: 'read',
  WRITE: 'write',
  DELETE: 'delete'
} as const;
export type Permission = typeof Permission[keyof typeof Permission];

/**
 * Application error codes (as const object)
 */
export const ErrorCode = {
  AUTHENTICATION: 'authentication_error',
  AUTHORIZATION: 'authorization_error',
  VALIDATION: 'validation_error',
  NOT_FOUND: 'not_found',
  RATE_LIMIT: 'rate_limit',
  SERVER_ERROR: 'server_error',
  EXTERNAL_SERVICE: 'external_service_error'
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E; code?: string }; // Optional code for specific errors


// Base type for resources that have an owner
export interface Resource {
  id: string | number; // Allow string or number ID
  userId: string; // Crucial for ownership check
  // other common fields if any
}