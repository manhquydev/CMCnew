// Process-wide structured logger (pino). JSON in production (for log aggregation); pretty-printed
// in dev/test. Level from LOG_LEVEL — same inert-until-env shape as the rest of the codebase (no
// LOG_LEVEL set → defaults to 'info', zero config needed to run locally).
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  // Never let response bodies/headers containing secrets leak into logs (redact if ever passed).
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'], remove: true },
});
