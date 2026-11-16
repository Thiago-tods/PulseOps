type Level = 'error' | 'warn' | 'info' | 'debug';
const ORDER: Level[] = ['error', 'warn', 'info', 'debug'];

export interface Logger {
  error(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
}

/** Logger JSON estruturado, uma linha por evento. */
export function createLogger(minLevel: Level, service = 'pulseops-worker'): Logger {
  const emit = (level: Level, message: string, extra?: Record<string, unknown>): void => {
    if (ORDER.indexOf(level) > ORDER.indexOf(minLevel)) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      service,
      message,
      ...extra,
    });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    error: (m, e) => emit('error', m, e),
    warn: (m, e) => emit('warn', m, e),
    info: (m, e) => emit('info', m, e),
    debug: (m, e) => emit('debug', m, e),
  };
}
