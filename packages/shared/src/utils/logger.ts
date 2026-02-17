export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
};

const RESET = '\x1b[0m';

export class Logger {
  private context: string;
  private minLevel: LogLevel;

  constructor(context: string, minLevel: LogLevel = 'info') {
    this.context = context;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const prefix = `${color}[${timestamp}] [${level.toUpperCase()}] [${this.context}]${RESET}`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `${prefix} ${message}${dataStr}`;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, data));
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, data));
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, data));
    }
  }

  error(message: string, errorOrData?: Error | Record<string, unknown> | unknown, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      const errorData = errorOrData instanceof Error
        ? { ...data, error: errorOrData.message, stack: errorOrData.stack }
        : typeof errorOrData === 'object' && errorOrData !== null && !(errorOrData instanceof Error)
          ? { ...data, ...(errorOrData as Record<string, unknown>) }
          : errorOrData !== undefined
            ? { ...data, error: String(errorOrData) }
            : data ?? {};
      console.error(this.formatMessage('error', message, errorData as Record<string, unknown>));
    }
  }

  fatal(message: string, errorOrData?: Error | Record<string, unknown> | unknown, data?: Record<string, unknown>): void {
    if (this.shouldLog('fatal')) {
      const errorData = errorOrData instanceof Error
        ? { ...data, error: errorOrData.message, stack: errorOrData.stack }
        : typeof errorOrData === 'object' && errorOrData !== null && !(errorOrData instanceof Error)
          ? { ...data, ...(errorOrData as Record<string, unknown>) }
          : errorOrData !== undefined
            ? { ...data, error: String(errorOrData) }
            : data ?? {};
      console.error(this.formatMessage('fatal', message, errorData as Record<string, unknown>));
    }
  }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, this.minLevel);
  }
}

export function createLogger(context: string, minLevel?: LogLevel): Logger {
  return new Logger(context, minLevel);
}
