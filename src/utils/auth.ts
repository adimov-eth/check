// src/utils/auth.ts
import { config } from '@/config';
import { logger } from '@/utils/logger';
import type { ExpressRequestWithAuth } from '@clerk/express';
import * as jose from 'jose';

interface ClerkJWTPayload extends jose.JWTPayload {
  azp?: string;
  sid?: string;
  sub: string;
}

export const verifySessionToken = async (token: string): Promise<string | null> => {
  try {
    // Fetch Clerk's JWKS (JSON Web Key Set)
    const JWKS = jose.createRemoteJWKSet(
      new URL('https://clerk.clerk.dev/.well-known/jwks.json')
    );

    // Verify the JWT
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: 'https://clerk.clerk.dev',
      audience: config.clerkSecretKey,
    });


    const clerkPayload = payload as ClerkJWTPayload;
    
    if (!clerkPayload.sub) {
      throw new Error('Invalid token: missing sub claim');
    }
    
    return clerkPayload.sub;
  } catch (error) {
    logger.error('Token verification failed:', { error });
    return null;
  }
};

export const getUserId = (req: ExpressRequestWithAuth): string | null => req.auth?.userId ?? null;