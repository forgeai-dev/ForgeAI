import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SkillRegistry,
  createSkillRegistry,
  InMemorySkillStore,
  validateManifest,
} from '../packages/agent/src/skill-registry.js';
import type {
  SkillManifest,
  InstalledSkill,
  SkillStore,
} from '../packages/agent/src/skill-registry.js';

// ─── Test Fixtures ──────────────────────────────────────

function createValidManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill for unit testing purposes',
    category: 'custom',
    tools: [
      {
        name: 'test_tool',
        description: 'A test tool that echoes input',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to echo' },
          },
          required: ['message'],
        },
        handler: {
          type: 'function',
          value: 'return "Echo: " + params.message;',
        },
      },
    ],
    ...overrides,
  };
}

function createHttpSkillManifest(): SkillManifest {
  return {
    id: 'http-skill',
    name: 'HTTP Skill',
    version: '1.0.0',
    description: 'A skill that makes HTTP requests',
    category: 'integration',
    tools: [
      {
        name: 'http_get_data',
        description: 'Fetch data from an API endpoint',
        parameters: {
          type: 'object',
          properties: {
            endpoint: { type: 'string', description: 'API endpoint path' },
          },
          required: ['endpoint'],
        },
        handler: {
          type: 'http',
          value: 'https://api.example.com/{{endpoint}}',
          method: 'GET',
          headers: { 'Authorization': 'Bearer {{config.api_key}}' },
        },
      },
    ],
    config: {
      api_key: { type: 'string', description: 'API key', required: true },
    },
  };
}

function createMultiToolManifest(): SkillManifest {
  return {
    id: 'multi-tool',
    name: 'Multi Tool Skill',
    version: '2.0.0',
    description: 'A skill with multiple tools for testing',
    category: 'productivity',
    tools: [
      {
        name: 'multi_add',
        description: 'Add two numbers together',
        parameters: {
          type: 'object',
          properties: {
            num_a: { type: 'number', description: 'First number' },
            num_b: { type: 'number', description: 'Second number' },
          },
          required: ['num_a', 'num_b'],
        },
        handler: {
          type: 'function',
          value: 'return params.num_a + params.num_b;',
        },
      },
      {
        name: 'multi_concat',
        description: 'Concatenate two strings',
        parameters: {
          type: 'object',
          properties: {
            str_a: { type: 'string', description: 'First string' },
            str_b: { type: 'string', description: 'Second string' },
          },
          required: ['str_a', 'str_b'],
        },
        handler: {
          type: 'function',
          value: 'return params.str_a + params.str_b;',
        },
      },
    ],
    promptContext: 'This skill provides math and string operations.',
  };
}

// ─── validateManifest Tests ─────────────────────────────

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    expect(validateManifest(createValidManifest())).toBeNull();
  });

  it('should reject invalid skill ID', () => {
    const err = validateManifest(createValidManifest({ id: 'AB' }));
    expect(err).toContain('Invalid skill ID');
  });

  it('should reject skill ID with uppercase', () => {
    const err = validateManifest(createValidManifest({ id: 'TestSkill' }));
    expect(err).toContain('Invalid skill ID');
  });

  it('should reject empty name', () => {
    const err = validateManifest(createValidManifest({ name: '' }));
    expect(err).toContain('name');
  });

  it('should reject invalid version', () => {
    const err = validateManifest(createValidManifest({ version: 'abc' }));
    expect(err).toContain('version');
  });

  it('should reject short description', () => {
    const err = validateManifest(createValidManifest({ description: 'short' }));
    expect(err).toContain('description');
  });

  it('should reject invalid category', () => {
    const err = validateManifest(createValidManifest({ category: 'invalid' as any }));
    expect(err).toContain('category');
  });

  it('should reject empty tools array', () => {
    const err = validateManifest(createValidManifest({ tools: [] }));
    expect(err).toContain('at least one tool');
  });

  it('should reject reserved tool names', () => {
    const manifest = createValidManifest({
      tools: [{
        name: 'shell_exec',
        description: 'Overriding shell exec',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: { type: 'function', value: 'return 1;' },
      }],
    });
    const err = validateManifest(manifest);
    expect(err).toContain('reserved');
  });

  it('should reject tool without handler', () => {
    const manifest = createValidManifest({
      tools: [{
        name: 'no_handler',
        description: 'Tool without handler definition',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: undefined as any,
      }],
    });
    const err = validateManifest(manifest);
    expect(err).toContain('handler');
  });

  it('should reject invalid handler type', () => {
    const manifest = createValidManifest({
      tools: [{
        name: 'bad_handler',
        description: 'Tool with invalid handler type',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: { type: 'invalid' as any, value: 'test' },
      }],
    });
    const err = validateManifest(manifest);
    expect(err).toContain('handler type');
  });

  it('should reject too many tools', () => {
    const tools = Array.from({ length: 11 }, (_, i) => ({
      name: `tool_${String(i).padStart(3, '0')}`,
      description: 'A generated test tool',
      parameters: { type: 'object' as const, properties: {}, required: [] as string[] },
      handler: { type: 'function' as const, value: 'return 1;' },
    }));
    const err = validateManifest(createValidManifest({ tools }));
    expect(err).toContain('Too many tools');
  });

  it('should accept all valid categories', () => {
    const categories = ['productivity', 'development', 'data', 'communication', 'automation', 'analysis', 'integration', 'custom'] as const;
    for (const cat of categories) {
      expect(validateManifest(createValidManifest({ category: cat }))).toBeNull();
    }
  });
});

// ─── InMemorySkillStore Tests ───────────────────────────

describe('InMemorySkillStore', () => {
  let store: InMemorySkillStore;

  beforeEach(() => {
    store = new InMemorySkillStore();
  });

  it('should save and retrieve a skill', async () => {
    const skill: InstalledSkill = {
      manifest: createValidManifest(),
      status: 'installed',
      installedAt: Date.now(),
      configValues: {},
    };
    await store.save(skill);
    const retrieved = await store.get('test-skill');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.manifest.id).toBe('test-skill');
  });

  it('should return null for non-existent skill', async () => {
    const result = await store.get('non-existent');
    expect(result).toBeNull();
  });

  it('should list all skills', async () => {
    await store.save({
      manifest: createValidManifest({ id: 'skill-aaa' }),
      status: 'installed',
      installedAt: Date.now(),
      configValues: {},
    });
    await store.save({
      manifest: createValidManifest({ id: 'skill-bbb' }),
      status: 'active',
      installedAt: Date.now(),
      configValues: {},
    });
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it('should delete a skill', async () => {
    await store.save({
      manifest: createValidManifest(),
      status: 'installed',
      installedAt: Date.now(),
      configValues: {},
    });
    const deleted = await store.delete('test-skill');
    expect(deleted).toBe(true);
    expect(await store.get('test-skill')).toBeNull();
  });

  it('should return false when deleting non-existent skill', async () => {
    const deleted = await store.delete('non-existent');
    expect(deleted).toBe(false);
  });

  it('should return deep copies (no mutation)', async () => {
    const skill: InstalledSkill = {
      manifest: createValidManifest(),
      status: 'installed',
      installedAt: Date.now(),
      configValues: { key: 'value' },
    };
    await store.save(skill);
    const retrieved = await store.get('test-skill');
    retrieved!.configValues.key = 'mutated';
    const again = await store.get('test-skill');
    expect(again!.configValues.key).toBe('value');
  });
});

// ─── SkillRegistry Tests ────────────────────────────────

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = createSkillRegistry();
  });

  // ─── Install ──────────────────────────────────────

  describe('install', () => {
    it('should install a valid skill', async () => {
      const result = await registry.install(createValidManifest());
      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill!.status).toBe('installed');
    });

    it('should reject invalid manifest', async () => {
      const result = await registry.install(createValidManifest({ id: '' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid skill ID');
    });

    it('should allow re-installing (updating) existing skill', async () => {
      await registry.install(createValidManifest());
      const result = await registry.install(createValidManifest({ version: '2.0.0' }));
      expect(result.success).toBe(true);
      const skill = await registry.getSkill('test-skill');
      expect(skill!.manifest.version).toBe('2.0.0');
    });

    it('should resolve config defaults', async () => {
      const manifest = createValidManifest({
        config: {
          color: { type: 'string', description: 'Color', default: 'blue' },
          count: { type: 'number', description: 'Count', default: 5 },
        },
      });
      const result = await registry.install(manifest);
      expect(result.success).toBe(true);
      expect(result.skill!.configValues).toEqual({ color: 'blue', count: 5 });
    });

    it('should use provided config values over defaults', async () => {
      const manifest = createValidManifest({
        config: {
          color: { type: 'string', description: 'Color', default: 'blue' },
        },
      });
      const result = await registry.install(manifest, { color: 'red' });
      expect(result.success).toBe(true);
      expect(result.skill!.configValues.color).toBe('red');
    });

    it('should reject missing required config', async () => {
      const manifest = createHttpSkillManifest(); // api_key is required
      const result = await registry.install(manifest);
      expect(result.success).toBe(false);
      expect(result.error).toContain('api_key');
    });

    it('should accept required config when provided', async () => {
      const manifest = createHttpSkillManifest();
      const result = await registry.install(manifest, { api_key: 'test-key-123' });
      expect(result.success).toBe(true);
    });

    it('should reject tool name conflicts between skills', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');

      // Try installing another skill with the same tool name
      const conflicting = createValidManifest({
        id: 'other-skill',
        name: 'Other Skill',
        tools: [{
          name: 'test_tool', // same name as test-skill's tool
          description: 'Conflicting tool name',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return 1;' },
        }],
      });
      const result = await registry.install(conflicting);
      expect(result.success).toBe(false);
      expect(result.error).toContain('conflicts');
    });

    it('should reject when dependency is not installed', async () => {
      const manifest = createValidManifest({ dependencies: ['non-existent'] });
      const result = await registry.install(manifest);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    it('should reject when dependency is installed but not active', async () => {
      await registry.install(createValidManifest({ id: 'dep-skill', name: 'Dep Skill' }));
      const manifest = createValidManifest({
        id: 'child-skill',
        name: 'Child Skill',
        tools: [{
          name: 'child_tool',
          description: 'Child tool that depends on dep-skill',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return 1;' },
        }],
        dependencies: ['dep-skill'],
      });
      const result = await registry.install(manifest);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });
  });

  // ─── Uninstall ────────────────────────────────────

  describe('uninstall', () => {
    it('should uninstall an installed skill', async () => {
      await registry.install(createValidManifest());
      const result = await registry.uninstall('test-skill');
      expect(result.success).toBe(true);
      const skill = await registry.getSkill('test-skill');
      expect(skill).toBeNull();
    });

    it('should fail for non-existent skill', async () => {
      const result = await registry.uninstall('non-existent');
      expect(result.success).toBe(false);
    });

    it('should prevent uninstalling a skill depended upon by an active skill', async () => {
      // Install and activate dep-skill
      await registry.install(createValidManifest({
        id: 'dep-skill',
        name: 'Dep Skill',
      }));
      await registry.activate('dep-skill');

      // Install and activate child that depends on dep-skill
      await registry.install(createValidManifest({
        id: 'child-skill',
        name: 'Child Skill',
        tools: [{
          name: 'child_tool',
          description: 'Child tool that needs dep-skill',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return 1;' },
        }],
        dependencies: ['dep-skill'],
      }));
      await registry.activate('child-skill');

      // Try to uninstall dep-skill
      const result = await registry.uninstall('dep-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('depends');
    });

    it('should clean up tool mappings on uninstall', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');
      expect(registry.hasToolNamed('test_tool')).toBe(true);

      await registry.uninstall('test-skill');
      expect(registry.hasToolNamed('test_tool')).toBe(false);
    });
  });

  // ─── Activate / Deactivate ────────────────────────

  describe('activate', () => {
    it('should activate an installed skill', async () => {
      await registry.install(createValidManifest());
      const result = await registry.activate('test-skill');
      expect(result.success).toBe(true);

      const skill = await registry.getSkill('test-skill');
      expect(skill!.status).toBe('active');
      expect(skill!.activatedAt).toBeDefined();
    });

    it('should be idempotent (activating already active)', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');
      const result = await registry.activate('test-skill');
      expect(result.success).toBe(true);
    });

    it('should fail for non-existent skill', async () => {
      const result = await registry.activate('non-existent');
      expect(result.success).toBe(false);
    });

    it('should reject if dependency is not active', async () => {
      // Install dep-skill (not active)
      await registry.install(createValidManifest({
        id: 'dep-skill',
        name: 'Dep Skill',
      }));
      // Activate dep-skill so we can install child with dependency
      await registry.activate('dep-skill');

      // Install child-skill that depends on dep-skill
      const installResult = await registry.install(createValidManifest({
        id: 'child-skill',
        name: 'Child Skill',
        tools: [{
          name: 'child_tool',
          description: 'Child needs dep-skill active',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return 1;' },
        }],
        dependencies: ['dep-skill'],
      }));
      expect(installResult.success).toBe(true);

      // Deactivate dep-skill, then try to activate child-skill
      await registry.deactivate('dep-skill');
      const result = await registry.activate('child-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('must be active');
    });

    it('should register tool mappings on activate', async () => {
      await registry.install(createMultiToolManifest());
      expect(registry.hasToolNamed('multi_add')).toBe(false);

      await registry.activate('multi-tool');
      expect(registry.hasToolNamed('multi_add')).toBe(true);
      expect(registry.hasToolNamed('multi_concat')).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an active skill', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');
      const result = await registry.deactivate('test-skill');
      expect(result.success).toBe(true);

      const skill = await registry.getSkill('test-skill');
      expect(skill!.status).toBe('disabled');
    });

    it('should be idempotent (deactivating non-active)', async () => {
      await registry.install(createValidManifest());
      const result = await registry.deactivate('test-skill');
      expect(result.success).toBe(true);
    });

    it('should prevent deactivating if other active skills depend on it', async () => {
      await registry.install(createValidManifest({ id: 'dep-skill', name: 'Dep Skill' }));
      await registry.activate('dep-skill');

      await registry.install(createValidManifest({
        id: 'child-skill',
        name: 'Child Skill',
        tools: [{
          name: 'child_tool',
          description: 'Depends on dep-skill',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return 1;' },
        }],
        dependencies: ['dep-skill'],
      }));
      await registry.activate('child-skill');

      const result = await registry.deactivate('dep-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('depends');
    });

    it('should remove tool mappings on deactivate', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');
      expect(registry.hasToolNamed('test_tool')).toBe(true);

      await registry.deactivate('test-skill');
      expect(registry.hasToolNamed('test_tool')).toBe(false);
    });
  });

  // ─── Query ────────────────────────────────────────

  describe('query', () => {
    it('should list all skills', async () => {
      await registry.install(createValidManifest());
      await registry.install(createMultiToolManifest());
      const all = await registry.listSkills();
      expect(all).toHaveLength(2);
    });

    it('should get a specific skill', async () => {
      await registry.install(createValidManifest());
      const skill = await registry.getSkill('test-skill');
      expect(skill).not.toBeNull();
      expect(skill!.manifest.name).toBe('Test Skill');
    });

    it('should return null for non-existent skill', async () => {
      const skill = await registry.getSkill('non-existent');
      expect(skill).toBeNull();
    });

    it('should count active skills', async () => {
      await registry.install(createValidManifest());
      await registry.install(createMultiToolManifest());
      expect(registry.getActiveSkillCount()).toBe(0);

      await registry.activate('test-skill');
      expect(registry.getActiveSkillCount()).toBe(1);

      await registry.activate('multi-tool');
      expect(registry.getActiveSkillCount()).toBe(2);
    });
  });

  // ─── Tool Integration ─────────────────────────────

  describe('getActiveToolsForLLM', () => {
    it('should return empty array when no skills are active', async () => {
      await registry.install(createValidManifest());
      const tools = registry.getActiveToolsForLLM();
      expect(tools).toHaveLength(0);
    });

    it('should return tools from active skills only', async () => {
      await registry.install(createValidManifest());
      await registry.install(createMultiToolManifest());
      await registry.activate('multi-tool');

      const tools = registry.getActiveToolsForLLM();
      expect(tools).toHaveLength(2);
      expect(tools[0].function.name).toBe('multi_add');
      expect(tools[1].function.name).toBe('multi_concat');
    });

    it('should prefix description with skill name', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');

      const tools = registry.getActiveToolsForLLM();
      expect(tools[0].function.description).toContain('[Skill: Test Skill]');
    });

    it('should have correct structure for LLM', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');

      const tools = registry.getActiveToolsForLLM();
      expect(tools[0].type).toBe('function');
      expect(tools[0].function).toHaveProperty('name');
      expect(tools[0].function).toHaveProperty('description');
      expect(tools[0].function).toHaveProperty('parameters');
    });
  });

  // ─── Tool Execution ───────────────────────────────

  describe('executeTool', () => {
    it('should execute a function handler', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');

      const result = await registry.executeTool('test_tool', { message: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Echo: hello');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should execute function handler with math', async () => {
      await registry.install(createMultiToolManifest());
      await registry.activate('multi-tool');

      const result = await registry.executeTool('multi_add', { num_a: 10, num_b: 20 });
      expect(result.success).toBe(true);
      expect(result.data).toBe(30);
    });

    it('should execute function handler with string concat', async () => {
      await registry.install(createMultiToolManifest());
      await registry.activate('multi-tool');

      const result = await registry.executeTool('multi_concat', { str_a: 'foo', str_b: 'bar' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('foobar');
    });

    it('should fail for non-existent tool', async () => {
      const result = await registry.executeTool('non_existent_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active skill');
    });

    it('should fail for inactive skill tool', async () => {
      await registry.install(createValidManifest());
      // NOT activated
      const result = await registry.executeTool('test_tool', { message: 'test' });
      expect(result.success).toBe(false);
    });

    it('should handle function handler errors gracefully', async () => {
      const manifest = createValidManifest({
        tools: [{
          name: 'error_tool',
          description: 'A tool that throws an error',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'throw new Error("test error");' },
        }],
      });
      await registry.install(manifest);
      await registry.activate('test-skill');

      const result = await registry.executeTool('error_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('test error');
    });

    it('should pass config values to function handler', async () => {
      const manifest = createValidManifest({
        tools: [{
          name: 'config_tool',
          description: 'A tool that reads config values',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return "key=" + config.api_key;' },
        }],
        config: {
          api_key: { type: 'string', description: 'API key', default: 'default-key' },
        },
      });
      await registry.install(manifest);
      await registry.activate('test-skill');

      const result = await registry.executeTool('config_tool', {});
      expect(result.success).toBe(true);
      expect(result.data).toBe('key=default-key');
    });
  });

  // ─── Prompt Context ───────────────────────────────

  describe('buildSkillContext', () => {
    it('should return null when no skills have prompt context', async () => {
      await registry.install(createValidManifest());
      await registry.activate('test-skill');
      expect(registry.buildSkillContext()).toBeNull();
    });

    it('should return context from active skills with promptContext', async () => {
      await registry.install(createMultiToolManifest()); // has promptContext
      await registry.activate('multi-tool');

      const ctx = registry.buildSkillContext();
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('Multi Tool Skill');
      expect(ctx).toContain('math and string operations');
    });

    it('should not include context from inactive skills', async () => {
      await registry.install(createMultiToolManifest());
      // NOT activated
      expect(registry.buildSkillContext()).toBeNull();
    });
  });

  // ─── Stats ────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct stats', async () => {
      await registry.install(createValidManifest());
      await registry.install(createMultiToolManifest());

      let stats = registry.getStats();
      expect(stats.total).toBe(2);
      expect(stats.installed).toBe(2);
      expect(stats.active).toBe(0);

      await registry.activate('test-skill');
      stats = registry.getStats();
      expect(stats.active).toBe(1);
      expect(stats.installed).toBe(1);
      expect(stats.totalTools).toBe(1); // test_tool

      await registry.activate('multi-tool');
      stats = registry.getStats();
      expect(stats.active).toBe(2);
      expect(stats.totalTools).toBe(3); // test_tool + multi_add + multi_concat

      await registry.deactivate('test-skill');
      stats = registry.getStats();
      expect(stats.active).toBe(1);
      expect(stats.disabled).toBe(1);
    });
  });

  // ─── Persistence ──────────────────────────────────

  describe('persistence', () => {
    it('should persist and restore skills via store', async () => {
      const store = new InMemorySkillStore();
      const reg1 = createSkillRegistry(store);
      await reg1.install(createValidManifest());
      await reg1.activate('test-skill');

      // Create a new registry with the same store
      const reg2 = createSkillRegistry(store);
      await reg2.initialize();
      const skill = await reg2.getSkill('test-skill');
      expect(skill).not.toBeNull();
      expect(skill!.status).toBe('active');
      expect(reg2.hasToolNamed('test_tool')).toBe(true);
    });

    it('should persist deactivation', async () => {
      const store = new InMemorySkillStore();
      const reg1 = createSkillRegistry(store);
      await reg1.install(createValidManifest());
      await reg1.activate('test-skill');
      await reg1.deactivate('test-skill');

      const reg2 = createSkillRegistry(store);
      await reg2.initialize();
      const skill = await reg2.getSkill('test-skill');
      expect(skill!.status).toBe('disabled');
      expect(reg2.hasToolNamed('test_tool')).toBe(false);
    });

    it('should persist uninstall', async () => {
      const store = new InMemorySkillStore();
      const reg1 = createSkillRegistry(store);
      await reg1.install(createValidManifest());
      await reg1.uninstall('test-skill');

      const reg2 = createSkillRegistry(store);
      await reg2.initialize();
      const all = await reg2.listSkills();
      expect(all).toHaveLength(0);
    });
  });

  // ─── Edge Cases ───────────────────────────────────

  describe('edge cases', () => {
    it('should handle initialize being called multiple times', async () => {
      await registry.install(createValidManifest());
      await (registry as any).initialize();
      await (registry as any).initialize();
      const all = await registry.listSkills();
      expect(all).toHaveLength(1);
    });

    it('should handle max skills limit', async () => {
      // Install 50 skills (the max)
      for (let i = 0; i < 50; i++) {
        const id = `skill-${String(i).padStart(3, '0')}`;
        await registry.install(createValidManifest({
          id,
          name: `Skill ${i}`,
          tools: [{
            name: `tool_s${String(i).padStart(3, '0')}`,
            description: `Tool for skill ${i} placeholder`,
            parameters: { type: 'object', properties: {}, required: [] },
            handler: { type: 'function', value: 'return 1;' },
          }],
        }));
      }

      // 51st should fail
      const result = await registry.install(createValidManifest({
        id: 'skill-overflow',
        name: 'Overflow Skill',
        tools: [{
          name: 'overflow_tool',
          description: 'This should not be allowed to install',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: { type: 'function', value: 'return 1;' },
        }],
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum');
    });

    it('should allow async function handlers via Promise', async () => {
      const manifest = createValidManifest({
        tools: [{
          name: 'async_tool',
          description: 'A tool that returns a promise value',
          parameters: { type: 'object', properties: {}, required: [] },
          handler: {
            type: 'function',
            value: 'return Promise.resolve(42);',
          },
        }],
      });
      await registry.install(manifest);
      await registry.activate('test-skill');

      const result = await registry.executeTool('async_tool', {});
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });
  });
});
