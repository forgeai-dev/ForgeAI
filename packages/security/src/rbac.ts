import type { UserRole, RBACPolicy, RBACPermission } from '@forgeai/shared';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:RBAC');

const DEFAULT_POLICIES: RBACPolicy[] = [
  {
    role: 'admin',
    permissions: [
      { resource: '*', actions: ['*'] },
    ],
  },
  {
    role: 'user',
    permissions: [
      { resource: 'session', actions: ['read', 'write', 'execute'] },
      { resource: 'message', actions: ['read', 'write'] },
      { resource: 'channel', actions: ['read'] },
      { resource: 'tool', actions: ['read', 'execute'] },
      { resource: 'skill', actions: ['read'] },
      { resource: 'config', actions: ['read'] },
      { resource: 'vault', actions: [] },
      { resource: 'audit', actions: ['read'] },
    ],
  },
  {
    role: 'guest',
    permissions: [
      { resource: 'session', actions: ['read'] },
      { resource: 'message', actions: ['read', 'write'] },
      { resource: 'channel', actions: [] },
      { resource: 'tool', actions: [] },
      { resource: 'skill', actions: [] },
      { resource: 'config', actions: [] },
      { resource: 'vault', actions: [] },
      { resource: 'audit', actions: [] },
    ],
  },
];

export class RBACEngine {
  private policies: Map<string, RBACPolicy> = new Map();
  private userOverrides: Map<string, RBACPermission[]> = new Map();

  constructor() {
    for (const policy of DEFAULT_POLICIES) {
      this.policies.set(policy.role, policy);
    }
    logger.info('RBAC engine initialized with default policies');
  }

  addPolicy(policy: RBACPolicy): void {
    this.policies.set(policy.role, policy);
    logger.info('RBAC policy added', { role: policy.role });
  }

  removePolicy(role: string): boolean {
    const result = this.policies.delete(role);
    if (result) logger.info('RBAC policy removed', { role });
    return result;
  }

  setUserOverrides(userId: string, permissions: RBACPermission[]): void {
    this.userOverrides.set(userId, permissions);
    logger.info('User permission overrides set', { userId });
  }

  removeUserOverrides(userId: string): void {
    this.userOverrides.delete(userId);
  }

  check(role: UserRole, resource: string, action: string, userId?: string): boolean {
    // Check user-specific overrides first
    if (userId) {
      const overrides = this.userOverrides.get(userId);
      if (overrides) {
        const override = overrides.find(p => p.resource === resource || p.resource === '*');
        if (override) {
          const allowed = override.actions.includes(action) || override.actions.includes('*');
          logger.debug('RBAC check (override)', { userId, resource, action, allowed });
          return allowed;
        }
      }
    }

    const policy = this.policies.get(role);
    if (!policy) {
      logger.warn('RBAC check: no policy found for role', { role });
      return false;
    }

    for (const permission of policy.permissions) {
      const resourceMatch = permission.resource === '*' || permission.resource === resource;
      if (!resourceMatch) continue;

      const actionMatch = permission.actions.includes('*') || permission.actions.includes(action);
      if (actionMatch) {
        logger.debug('RBAC check passed', { role, resource, action });
        return true;
      }
    }

    logger.debug('RBAC check denied', { role, resource, action });
    return false;
  }

  enforce(role: UserRole, resource: string, action: string, userId?: string): void {
    if (!this.check(role, resource, action, userId)) {
      throw new RBACDeniedError(role, resource, action);
    }
  }

  getPolicies(): RBACPolicy[] {
    return Array.from(this.policies.values());
  }

  getPolicy(role: string): RBACPolicy | undefined {
    return this.policies.get(role);
  }
}

export class RBACDeniedError extends Error {
  public readonly role: string;
  public readonly resource: string;
  public readonly action: string;

  constructor(role: string, resource: string, action: string) {
    super(`Access denied: role '${role}' cannot '${action}' on '${resource}'`);
    this.name = 'RBACDeniedError';
    this.role = role;
    this.resource = resource;
    this.action = action;
  }
}

export function createRBACEngine(): RBACEngine {
  return new RBACEngine();
}
