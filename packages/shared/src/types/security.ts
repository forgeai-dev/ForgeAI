export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_failed'
  | 'auth.2fa_verified'
  | 'auth.2fa_failed'
  | 'session.create'
  | 'session.close'
  | 'session.suspend'
  | 'message.send'
  | 'message.receive'
  | 'tool.execute'
  | 'tool.blocked'
  | 'tool.approved'
  | 'tool.dangerous_call'
  | 'channel.connect'
  | 'channel.disconnect'
  | 'config.update'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'vault.access'
  | 'vault.update'
  | 'rate_limit.exceeded'
  | 'anomaly.detected'
  | 'prompt_injection.detected'
  | 'sandbox.violation'
  | 'backup.vault.export'
  | 'backup.vault.import'
  | 'backup.restore'
  | 'rate_limit.config'
  | 'security.alert_sent'
  | 'security.integrity_check'
  | 'security.rbac_denied'
  | 'audit.export'
  | 'auth.access_token_failed'
  | 'auth.access_token_used'
  | 'auth.access_token_generated'
  | 'auth.generate_denied'
  | 'auth.revoke_all'
  | 'auth.email_otp_sent'
  | 'auth.email_otp_verified'
  | 'auth.email_otp_failed'
  | 'auth.pin_changed'
  | 'tool.indirect_injection_blocked'
  | 'tool.sensitive_file_blocked'
  | 'tool.exfiltration_blocked'
  | 'tool.persistence_blocked';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  userId?: string;
  sessionId?: string;
  channelType?: string;
  resource?: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  riskLevel: RiskLevel;
  hash?: string;
  previousHash?: string;
}

export interface SecurityAlert {
  id: string;
  timestamp: Date;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  auditEntryId: string;
  notified: boolean;
}

export interface AuditIntegrityResult {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  brokenAt?: string;
  brokenEntryId?: string;
  message: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

export interface VaultEntry {
  key: string;
  encryptedValue: string;
  iv: string;
  tag: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptInjectionResult {
  safe: boolean;
  score: number;
  threats: PromptThreat[];
  sanitizedInput?: string;
}

export interface PromptThreat {
  type: 'instruction_override' | 'context_leak' | 'role_hijack' | 'data_exfil' | 'command_injection' | 'encoding_attack';
  confidence: number;
  matched: string;
  description: string;
}

export interface RBACPolicy {
  role: string;
  permissions: RBACPermission[];
}

export interface RBACPermission {
  resource: string;
  actions: string[];
  conditions?: Record<string, unknown>;
}
