import * as Joi from 'joi';
import { NodeEnv } from '../common/constants/enum';
import { LOG_LEVEL_NAMES } from './log-level';

// config files parse booleans with `=== 'true'`, so only accept lowercase 'true' / 'false'
const booleanString = () => Joi.boolean().sensitive();

// requires a unit: jsonwebtoken treats a bare numeric string as milliseconds
const ttlString = () =>
  Joi.string()
    .pattern(/^\d+[smhd]$/)
    .messages({
      'string.pattern.base': '{{#label}} must be a duration like 15m, 1h, 7d',
    });

export const envValidationSchema = Joi.object({
  // app
  NODE_ENV: Joi.string()
    .valid(...Object.values(NodeEnv))
    .default(NodeEnv.DEVELOPMENT),
  APP_NAME: Joi.string().allow(''),
  APP_HOST: Joi.string(),
  PORT: Joi.number().port(),
  LOG_LEVEL: Joi.string().valid(...LOG_LEVEL_NAMES),
  API_PREFIX: Joi.string().allow(''),
  API_VERSION: Joi.string().allow(''),
  CORS_ORIGINS: Joi.string().allow(''),
  CORS_CREDENTIALS: booleanString(),

  // database
  // DATABASE_HOST is preferred; HOST is still accepted (see .or() below).
  DATABASE_HOST: Joi.string().hostname(),
  HOST: Joi.string().hostname(),
  DATABASE_PORT: Joi.number().port(),
  DATABASE_USERNAME: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_DATABASE: Joi.string().required(),
  DATABASE_POOL_SIZE: Joi.number().integer().min(1).max(200),
  DATABASE_SYNCHRONIZE: booleanString().when('NODE_ENV', {
    is: NodeEnv.PRODUCTION,
    then: Joi.valid(false).messages({
      'any.only':
        'DATABASE_SYNCHRONIZE must never be enabled in production. Use migrations',
    }),
  }),
  DB_LOGGING: booleanString(),
  DATABASE_SSL: booleanString(),
  DATABASE_SSL_REJECT_UNAUTHORIZED: booleanString(),

  // docs
  DOCS_ENABLED: booleanString(),
  DOCS_PATH: Joi.string().allow(''),
  DOCS_DESCRIPTION: Joi.string().allow(''),

  // jwt
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .messages({
      'any.invalid': 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
    }),
  JWT_ACCESS_TTL: ttlString(),
  JWT_REFRESH_TTL: ttlString(),
  JWT_ISSUER: Joi.string(),
  JWT_AUDIENCE: Joi.string(),
  REFRESH_SESSION_MAX_DAYS: Joi.number().integer().min(1).max(365),
  REFRESH_REUSE_GRACE_SECONDS: Joi.number().integer().min(0).max(300),
  LOGIN_MAX_FAILURES: Joi.number().integer().min(0),
  LOGIN_FAILURE_WINDOW_SECONDS: Joi.number().integer().min(1),

  // caches (0 disables)
  USER_CACHE_TTL_MS: Joi.number().integer().min(0),
  DIRECTORY_CACHE_TTL_MS: Joi.number().integer().min(0),

  // password hashing
  HASH_CONCURRENCY: Joi.number().integer().min(1),
  HASH_QUEUE_MAX: Joi.number().integer().min(0),

  // scripts/cluster.mjs
  WORKERS: Joi.number().integer().min(1),
}).or('DATABASE_HOST', 'HOST');
