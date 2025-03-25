// src/utils/auth.ts
import { logger } from '@/utils/logger';
import * as jose from 'jose';

interface ClerkJWTPayload extends jose.JWTPayload {
  azp?: string;
  sid?: string;
  sub: string;
}

export const verifySessionToken = async (token: string): Promise<string | null> => {
  try {
    const JWKS = jose.createRemoteJWKSet(
      new URL('https://clerk.bkk.lol/.well-known/jwks.json')
    );

    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: 'https://clerk.bkk.lol',
      // No audience specified unless required by your Clerk setup
    });

    const clerkPayload = payload as ClerkJWTPayload;

    if (!clerkPayload.sub) {
      throw new Error('Invalid token: missing sub claim');
    }

    // Log azp for debugging (optional; adjust based on your app's needs)
    if (clerkPayload.azp) {
      logger.debug(`Token azp claim: ${clerkPayload.azp}`);
      // Optionally validate azp against permitted origins if applicable
      // const permittedOrigins = ['https://your-app-domain.com'];
      // if (!permittedOrigins.includes(clerkPayload.azp)) {
      //   throw new Error('Invalid azp claim');
      // }
    }

    return clerkPayload.sub; // userId
  } catch (error) {
    logger.error('Token verification failed:', { error });
    return null;
  }
};