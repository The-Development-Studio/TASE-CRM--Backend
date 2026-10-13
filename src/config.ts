import 'dotenv/config';
import { z } from 'zod';

const optionalSecret = z.string().trim().min(1).optional().transform((value) =>
  value && !/replace_me|<your_password>|<password>/i.test(value) ? value : undefined
);
const bootstrapSecret = optionalSecret.refine((value) => !value || value.length >= 32);
const optionalSender = z.string().trim().min(1).optional().transform((value) =>
  value && !/example\.com|replace_me|<>/i.test(value) ? value : undefined
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(Number(process.env.PORT) || 3001),
  CLIENT_ORIGIN: z.string().default('http://localhost:8443').refine(
    (value) => value.split(',').every((origin) => {
      try {
        const url = new URL(origin.trim());
        return ['http:', 'https:'].includes(url.protocol) && url.origin === origin.trim();
      } catch {
        return false;
      }
    }),
    'CLIENT_ORIGIN must be a comma-separated list of URL origins without paths'
  ),
  MONGODB_URI: optionalSecret,
  MONGODB_DB_NAME: z.string().trim().min(1).default('tds_crm'),
  DNS_SERVERS: z.string().default('').transform((value) => value.split(',').map((server) => server.trim()).filter(Boolean)),
  STAFF_ADMIN_KEY: bootstrapSecret,
  R2_ACCOUNT_ID: optionalSecret,
  R2_ACCESS_KEY_ID: optionalSecret,
  R2_SECRET_ACCESS_KEY: optionalSecret,
  R2_BUCKET: optionalSecret,
  RESEND_FROM_EMAIL: optionalSender,
  RESEND_API_KEY: optionalSecret,
  RESEND_WEBHOOK_SECRET: optionalSecret
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid backend environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid backend environment configuration');
}

export const config = parsed.data;

export const requireConfig = (key: 'MONGODB_URI' | 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL' | 'RESEND_WEBHOOK_SECRET') => {
  const value = config[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

if (config.NODE_ENV === 'production') {
  const missing = [
    !config.MONGODB_URI && 'MONGODB_URI',
    !config.STAFF_ADMIN_KEY && 'STAFF_ADMIN_KEY',
    config.STAFF_ADMIN_KEY && config.STAFF_ADMIN_KEY.length < 32 && 'STAFF_ADMIN_KEY must be at least 32 characters',
    !process.env.CLIENT_ORIGIN && 'CLIENT_ORIGIN',
    config.CLIENT_ORIGIN.includes('localhost') && 'CLIENT_ORIGIN must use the deployed frontend origin',
    !config.RESEND_API_KEY && 'RESEND_API_KEY',
    !config.RESEND_FROM_EMAIL && 'RESEND_FROM_EMAIL',
    !config.RESEND_WEBHOOK_SECRET && 'RESEND_WEBHOOK_SECRET',
    !config.R2_ACCOUNT_ID && 'R2_ACCOUNT_ID',
    !config.R2_ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID',
    !config.R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
    !config.R2_BUCKET && 'R2_BUCKET'
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Missing production configuration: ${missing.join(', ')}`);
    throw new Error('Production environment configuration is incomplete');
  }
}
