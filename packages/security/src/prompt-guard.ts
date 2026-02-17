import type { PromptInjectionResult, PromptThreat } from '@forgeai/shared';
import { PROMPT_INJECTION_PATTERNS, DANGEROUS_COMMANDS, createLogger } from '@forgeai/shared';

const logger = createLogger('Security:PromptGuard');

interface PromptGuardConfig {
  enabled: boolean;
  blockThreshold: number;
  warnThreshold: number;
  customPatterns: RegExp[];
  customDangerousCommands: string[];
}

const DEFAULT_CONFIG: PromptGuardConfig = {
  enabled: true,
  blockThreshold: 0.7,
  warnThreshold: 0.4,
  customPatterns: [],
  customDangerousCommands: [],
};

export class PromptGuard {
  private config: PromptGuardConfig;
  private allPatterns: RegExp[];
  private allDangerousCommands: string[];

  constructor(config?: Partial<PromptGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.allPatterns = [...PROMPT_INJECTION_PATTERNS, ...this.config.customPatterns];
    this.allDangerousCommands = [...DANGEROUS_COMMANDS, ...this.config.customDangerousCommands];
  }

  analyze(input: string): PromptInjectionResult {
    if (!this.config.enabled) {
      return { safe: true, score: 0, threats: [] };
    }

    const threats: PromptThreat[] = [];

    // Check prompt injection patterns
    for (const pattern of this.allPatterns) {
      const match = input.match(pattern);
      if (match) {
        const threat = this.classifyPatternThreat(pattern, match[0]);
        threats.push(threat);
      }
    }

    // Check for dangerous commands
    for (const cmd of this.allDangerousCommands) {
      if (input.toLowerCase().includes(cmd.toLowerCase())) {
        threats.push({
          type: 'command_injection',
          confidence: 0.9,
          matched: cmd,
          description: `Dangerous command detected: ${cmd}`,
        });
      }
    }

    // Check for encoding attacks
    const encodingThreats = this.checkEncodingAttacks(input);
    threats.push(...encodingThreats);

    // Check for context manipulation
    const contextThreats = this.checkContextManipulation(input);
    threats.push(...contextThreats);

    // Calculate overall score
    const score = this.calculateScore(threats);
    const safe = score < this.config.blockThreshold;

    if (!safe) {
      logger.warn('Prompt injection detected', {
        score,
        threatCount: threats.length,
        types: threats.map(t => t.type),
      });
    } else if (score >= this.config.warnThreshold) {
      logger.info('Suspicious prompt detected', { score, threatCount: threats.length });
    }

    return {
      safe,
      score,
      threats,
      sanitizedInput: safe ? this.sanitize(input) : undefined,
    };
  }

  private classifyPatternThreat(pattern: RegExp, matched: string): PromptThreat {
    const source = pattern.source.toLowerCase();

    if (source.includes('ignore') || source.includes('disregard') || source.includes('forget')) {
      return { type: 'instruction_override', confidence: 0.85, matched, description: 'Attempt to override instructions' };
    }
    if (source.includes('reveal') || source.includes('output') || source.includes('repeat') || source.includes('what')) {
      return { type: 'context_leak', confidence: 0.8, matched, description: 'Attempt to extract system prompt' };
    }
    if (source.includes('you are') || source.includes('act as') || source.includes('pretend') || source.includes('roleplay')) {
      return { type: 'role_hijack', confidence: 0.75, matched, description: 'Attempt to hijack assistant role' };
    }
    if (source.includes('override') || source.includes('bypass') || source.includes('jailbreak') || source.includes('dan')) {
      return { type: 'instruction_override', confidence: 0.9, matched, description: 'Attempt to bypass safety filters' };
    }
    if (source.includes('base64') || source.includes('eval') || source.includes('exec') || source.includes('\\\\x')) {
      return { type: 'encoding_attack', confidence: 0.85, matched, description: 'Encoded payload detected' };
    }

    return { type: 'instruction_override', confidence: 0.6, matched, description: 'Suspicious pattern detected' };
  }

  private checkEncodingAttacks(input: string): PromptThreat[] {
    const threats: PromptThreat[] = [];

    // Check for excessive Unicode escapes
    const unicodeEscapes = input.match(/\\u[0-9a-fA-F]{4}/g);
    if (unicodeEscapes && unicodeEscapes.length > 5) {
      threats.push({
        type: 'encoding_attack',
        confidence: 0.7,
        matched: `${unicodeEscapes.length} unicode escapes`,
        description: 'Excessive unicode escape sequences detected',
      });
    }

    // Check for zero-width characters
    const zeroWidth = input.match(/[\u200B\u200C\u200D\uFEFF\u200E\u200F]/g);
    if (zeroWidth && zeroWidth.length > 0) {
      threats.push({
        type: 'encoding_attack',
        confidence: 0.6,
        matched: `${zeroWidth.length} zero-width chars`,
        description: 'Zero-width characters detected (possible hidden text)',
      });
    }

    return threats;
  }

  private checkContextManipulation(input: string): PromptThreat[] {
    const threats: PromptThreat[] = [];

    // Check for fake message boundaries
    const fakeBoundaries = [
      /---\s*(system|assistant|human|user)\s*---/i,
      /<\|im_start\|>/i,
      /<\|im_end\|>/i,
      /\[INST\]/i,
      /\[\/INST\]/i,
      /<\/?system>/i,
      /Human:\s*$/im,
      /Assistant:\s*$/im,
    ];

    for (const pattern of fakeBoundaries) {
      const match = input.match(pattern);
      if (match) {
        threats.push({
          type: 'context_leak',
          confidence: 0.8,
          matched: match[0],
          description: 'Fake message boundary detected',
        });
      }
    }

    return threats;
  }

  private calculateScore(threats: PromptThreat[]): number {
    if (threats.length === 0) return 0;

    // Use the max confidence + boost for multiple threats
    const maxConfidence = Math.max(...threats.map(t => t.confidence));
    const multiThreatBoost = Math.min(0.2, (threats.length - 1) * 0.05);

    return Math.min(1, maxConfidence + multiThreatBoost);
  }

  private sanitize(input: string): string {
    let sanitized = input;

    // Remove zero-width characters
    sanitized = sanitized.replace(/[\u200B\u200C\u200D\uFEFF\u200E\u200F]/g, '');

    // Remove fake message boundaries
    sanitized = sanitized.replace(/<\|im_start\|>/gi, '');
    sanitized = sanitized.replace(/<\|im_end\|>/gi, '');
    sanitized = sanitized.replace(/\[INST\]/gi, '');
    sanitized = sanitized.replace(/\[\/INST\]/gi, '');

    return sanitized.trim();
  }

  updateConfig(config: Partial<PromptGuardConfig>): void {
    this.config = { ...this.config, ...config };
    this.allPatterns = [...PROMPT_INJECTION_PATTERNS, ...this.config.customPatterns];
    this.allDangerousCommands = [...DANGEROUS_COMMANDS, ...this.config.customDangerousCommands];
  }
}

export function createPromptGuard(config?: Partial<PromptGuardConfig>): PromptGuard {
  return new PromptGuard(config);
}
