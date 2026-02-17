import { createLogger, DANGEROUS_COMMANDS } from '@forgeai/shared';

const logger = createLogger('Security:InputSanitizer');

export interface SanitizeResult {
  clean: boolean;
  sanitized: string;
  blocked: string[];
  warnings: string[];
}

export class InputSanitizer {
  private dangerousCommands: string[];
  private maxInputLength: number;

  constructor(maxInputLength: number = 50_000) {
    this.dangerousCommands = [...DANGEROUS_COMMANDS];
    this.maxInputLength = maxInputLength;
  }

  sanitize(input: string): SanitizeResult {
    const blocked: string[] = [];
    const warnings: string[] = [];
    let sanitized = input;

    // Check length
    if (sanitized.length > this.maxInputLength) {
      sanitized = sanitized.slice(0, this.maxInputLength);
      warnings.push(`Input truncated from ${input.length} to ${this.maxInputLength} chars`);
    }

    // Remove null bytes
    if (sanitized.includes('\0')) {
      sanitized = sanitized.replace(/\0/g, '');
      warnings.push('Null bytes removed');
    }

    // Check for SQL injection patterns
    const sqlPatterns = [
      /'\s*OR\s+'?\d*'?\s*=\s*'?\d*'?/gi,
      /'\s*;\s*DROP\s+/gi,
      /'\s*;\s*DELETE\s+/gi,
      /'\s*;\s*INSERT\s+/gi,
      /'\s*;\s*UPDATE\s+/gi,
      /UNION\s+SELECT/gi,
      /'\s*--\s*$/gm,
    ];

    for (const pattern of sqlPatterns) {
      if (pattern.test(sanitized)) {
        blocked.push(`SQL injection pattern: ${pattern.source}`);
      }
    }

    // Check for XSS patterns
    const xssPatterns = [
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /on\w+\s*=\s*["'][^"']*["']/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /data:text\/html/gi,
    ];

    for (const pattern of xssPatterns) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '[BLOCKED]');
        blocked.push(`XSS pattern: ${pattern.source}`);
      }
    }

    // Check for dangerous shell commands
    for (const cmd of this.dangerousCommands) {
      if (sanitized.toLowerCase().includes(cmd.toLowerCase())) {
        blocked.push(`Dangerous command: ${cmd}`);
      }
    }

    // Check for path traversal
    if (/\.\.[\/\\]/.test(sanitized)) {
      warnings.push('Path traversal pattern detected');
    }

    const clean = blocked.length === 0;

    if (!clean) {
      logger.warn('Input blocked', { blockedCount: blocked.length, blocked });
    }

    return { clean, sanitized, blocked, warnings };
  }

  sanitizeHTML(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  sanitizeShellArg(input: string): string {
    // Escape shell special characters
    return input.replace(/([;&|`$(){}[\]!#~*?<>^])/g, '\\$1');
  }

  addDangerousCommand(cmd: string): void {
    this.dangerousCommands.push(cmd);
  }
}

export function createInputSanitizer(maxInputLength?: number): InputSanitizer {
  return new InputSanitizer(maxInputLength);
}
