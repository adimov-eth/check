export interface RedisConfig {
  readonly host: string;
  readonly port: number;
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequestsPerWindow: {
    readonly default: number;
    readonly auth: number;
    readonly conversations: number;
    readonly audio: number;
    readonly subscriptions: number;
    readonly usage: number;
    readonly users: number;
  };
}

export interface FreeTierConfig {
  readonly weeklyConversationLimit: number;
}

export interface JWTConfig {
  readonly secret: string;
  readonly expiresIn: string;
}

export interface AppConfig {
  readonly port: number;
  readonly nodeEnv: string;
  readonly openaiApiKey: string;
  readonly appleSharedSecret: string;
  readonly appleBundleId: string;
  readonly validAppleBundleIds: readonly string[];
  readonly redis: RedisConfig;
  readonly uploadsDir: string;
  readonly rateLimit: RateLimitConfig;
  readonly freeTier: FreeTierConfig;
  readonly jwt: JWTConfig;
} 