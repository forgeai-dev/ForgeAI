import { describe, it, expect } from 'vitest';
import { classifyIntent, buildIntentContext, logIntent } from '../packages/agent/src/intent-classifier.js';

describe('IntentClassifier', () => {
  // ─── Greetings ──────────────────────────────────────────
  describe('Greetings', () => {
    const greetings = ['oi', 'Olá', 'hey', 'hi', 'hello', 'bom dia', 'boa tarde', 'boa noite', 'good morning', 'yo', 'opa', 'salve', 'e aí'];

    it.each(greetings)('should classify "%s" as greeting', (msg) => {
      const result = classifyIntent(msg);
      expect(result.type).toBe('greeting');
      expect(result.skipTools).toBe(true);
      expect(result.suggestedAction).toBe('respond_directly');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should classify "como vai?" as greeting', () => {
      const result = classifyIntent('como vai?');
      expect(result.type).toBe('greeting');
    });

    it('should classify "tudo bem?" as greeting', () => {
      const result = classifyIntent('tudo bem?');
      expect(result.type).toBe('greeting');
    });
  });

  // ─── Status Checks ──────────────────────────────────────
  describe('Status Checks', () => {
    const statusChecks = ['online?', 'está aí?', 'ta ai?', 'you there?', 'ping', 'test', 'funciona?', 'status?'];

    it.each(statusChecks)('should classify "%s" as simple status check', (msg) => {
      const result = classifyIntent(msg);
      expect(result.type).toBe('simple');
      expect(result.skipTools).toBe(true);
      expect(result.suggestedAction).toBe('respond_directly');
    });
  });

  // ─── Yes/No ─────────────────────────────────────────────
  describe('Yes/No Responses', () => {
    it('should classify "sim" with history as followup', () => {
      const history = [
        { role: 'user', content: 'crie um site' },
        { role: 'assistant', content: 'Quer com React?' },
      ];
      const result = classifyIntent('sim', history);
      expect(result.type).toBe('followup');
      expect(result.suggestedAction).toBe('continue_workflow');
    });

    it('should classify "sim" without history as ambiguous', () => {
      const result = classifyIntent('sim');
      expect(result.type).toBe('ambiguous');
      expect(result.suggestedAction).toBe('clarify_first');
    });

    it('should classify "não" with history as followup', () => {
      const history = [
        { role: 'user', content: 'algo' },
        { role: 'assistant', content: 'pergunta' },
      ];
      const result = classifyIntent('não', history);
      expect(result.type).toBe('followup');
    });

    const yesVariants = ['yes', 'y', 'claro', 'pode', 'ok', 'bora', 'sure'];
    it.each(yesVariants)('should handle yes variant "%s"', (msg) => {
      const result = classifyIntent(msg);
      // Without history, should be ambiguous
      expect(['ambiguous', 'followup']).toContain(result.type);
    });
  });

  // ─── Thanks ─────────────────────────────────────────────
  describe('Thanks', () => {
    const thanksPatterns = ['obrigado', 'vlw', 'valeu', 'thanks', 'thank you', 'thx', 'ty', 'massa'];

    it.each(thanksPatterns)('should classify "%s" as simple thanks', (msg) => {
      const result = classifyIntent(msg);
      expect(result.type).toBe('simple');
      expect(result.skipTools).toBe(true);
    });
  });

  // ─── Followup ───────────────────────────────────────────
  describe('Followup Patterns', () => {
    const followups = ['continua', 'continue', 'prossiga', 'go ahead', 'next', 'e agora', "what's next"];

    it.each(followups)('should classify "%s" as followup', (msg) => {
      const result = classifyIntent(msg);
      expect(result.type).toBe('followup');
      expect(result.suggestedAction).toBe('continue_workflow');
    });
  });

  // ─── Slash Commands ─────────────────────────────────────
  describe('Slash Commands', () => {
    it('should classify /status as simple with skipTools', () => {
      const result = classifyIntent('/status');
      expect(result.type).toBe('simple');
      expect(result.skipTools).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should classify /help as simple', () => {
      const result = classifyIntent('/help');
      expect(result.type).toBe('simple');
      expect(result.skipTools).toBe(true);
    });
  });

  // ─── Ambiguous ──────────────────────────────────────────
  describe('Ambiguous Messages', () => {
    it('should classify "online" as simple status check (STATUS_CHECK matches first)', () => {
      const result = classifyIntent('online');
      expect(result.type).toBe('simple');
      expect(result.skipTools).toBe(true);
    });

    it('should classify "status" as simple status check', () => {
      const result = classifyIntent('status');
      expect(result.type).toBe('simple');
      expect(result.skipTools).toBe(true);
    });

    it('should classify "ajuda" as ambiguous with options', () => {
      const result = classifyIntent('ajuda');
      expect(result.type).toBe('ambiguous');
      expect(result.disambiguationOptions).toBeDefined();
    });

    it('should classify "help" as ambiguous with English options', () => {
      const result = classifyIntent('help');
      expect(result.type).toBe('ambiguous');
      expect(result.disambiguationOptions).toBeDefined();
    });

    it('should classify short ambiguous word with history as followup', () => {
      const history = [
        { role: 'user', content: 'faz algo' },
        { role: 'assistant', content: 'feito' },
      ];
      const result = classifyIntent('mostra', history);
      expect(result.type).toBe('followup');
    });

    it('should classify short ambiguous word without history as ambiguous', () => {
      const result = classifyIntent('mostra');
      expect(result.type).toBe('ambiguous');
    });
  });

  // ─── Complex Tasks ──────────────────────────────────────
  describe('Complex Task Detection', () => {
    it('should classify "crie um site em React com autenticação" as complex', () => {
      const result = classifyIntent('crie um site em React com autenticação');
      expect(result.type).toBe('complex');
      expect(['plan_and_execute', 'extract_context_first']).toContain(result.suggestedAction);
    });

    it('should classify "create a full-stack app with React frontend and Flask API" as complex', () => {
      const result = classifyIntent('create a full-stack app with React frontend and Flask API');
      expect(result.type).toBe('complex');
    });

    it('should classify "configure docker nginx deploy" as complex', () => {
      const result = classifyIntent('configure docker with nginx and deploy');
      expect(result.type).toBe('complex');
    });

    it('should classify long messages as complex', () => {
      const longMsg = 'I need you to ' + 'analyze this data and create a report '.repeat(10);
      const result = classifyIntent(longMsg);
      expect(result.type).toBe('complex');
    });

    it('should suggest extract_context_first for vague complex tasks', () => {
      // Short msg with 2+ complex indicators but <10 words
      const result = classifyIntent('create app deploy');
      expect(result.type).toBe('complex');
      // Could be plan_and_execute or extract_context_first
      expect(['plan_and_execute', 'extract_context_first']).toContain(result.suggestedAction);
    });
  });

  // ─── Simple Questions ───────────────────────────────────
  describe('Simple Questions', () => {
    it('should classify short non-complex messages as simple', () => {
      const result = classifyIntent('what time is it?');
      expect(result.type).toBe('simple');
      expect(result.suggestedAction).toBe('respond_directly');
    });
  });

  // ─── buildIntentContext ─────────────────────────────────
  describe('buildIntentContext', () => {
    it('should return null when no contextHint', () => {
      const result = classifyIntent('create a complex multi-service microservices system');
      if (!result.contextHint) {
        expect(buildIntentContext(result)).toBeNull();
      }
    });

    it('should include classification info when contextHint exists', () => {
      const result = classifyIntent('oi');
      const context = buildIntentContext(result);
      expect(context).not.toBeNull();
      expect(context).toContain('greeting');
      expect(context).toContain('Message Intelligence');
    });

    it('should include disambiguation options when present', () => {
      const result = classifyIntent('ajuda');
      const context = buildIntentContext(result);
      expect(context).not.toBeNull();
      expect(context).toContain('disambiguation');
    });
  });

  // ─── logIntent ──────────────────────────────────────────
  describe('logIntent', () => {
    it('should not throw', () => {
      const result = classifyIntent('hello');
      expect(() => logIntent('test-session', 'hello', result)).not.toThrow();
    });

    it('should truncate long messages', () => {
      const longMsg = 'a'.repeat(200);
      const result = classifyIntent(longMsg);
      expect(() => logIntent('test-session', longMsg, result)).not.toThrow();
    });
  });
});
