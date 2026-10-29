import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { REDACTED, redactPaths } from './redaction.js';

export interface LoggerSettings {
  service: 'api' | 'worker' | 'web' | 'script';
  environment: string;
  level: string;
}

/** Structured JSON logs with redaction. Shared by API, worker, and scripts. */
export function loggerOptions(s: LoggerSettings): LoggerOptions {
  return {
    level: s.level,
    base: { service: s.service, env: s.environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    redact: { paths: redactPaths(), censor: REDACTED },
    formatters: { level: (label) => ({ level: label }) },
  };
}

export function createLogger(s: LoggerSettings, destination?: DestinationStream): Logger {
  return destination ? pino(loggerOptions(s), destination) : pino(loggerOptions(s));
}

export type { Logger };
