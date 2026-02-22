export const APP_NAME = 'ForgeAI';
export const APP_VERSION = '0.1.0';
export const APP_DESCRIPTION = 'Security-first personal AI assistant';

export const DEFAULT_GATEWAY_HOST = '127.0.0.1';
export const DEFAULT_GATEWAY_PORT = 18800;
export const DEFAULT_WS_PORT = 18801;

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 600;

export const VAULT_ALGORITHM = 'aes-256-gcm';
export const VAULT_KEY_DERIVATION = 'pbkdf2';
export const VAULT_ITERATIONS = 600_000;
export const VAULT_KEY_LENGTH = 32;
export const VAULT_SALT_LENGTH = 32;
export const VAULT_IV_LENGTH = 16;
export const VAULT_TAG_LENGTH = 16;

export const JWT_DEFAULT_EXPIRES_IN = '24h';

export const SESSION_MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export const DANGEROUS_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'rm -rf --no-preserve-root',
  ':(){:|:&};:',
  'dd if=/dev/zero of=/dev/sd',
  'dd if=/dev/zero of=/dev/nvme',
  'format c:',
  'del /f /s /q c:\\windows\\system32',
  'rd /s /q c:\\windows\\system32',
  'rd /s /q c:\\',
  'rd /s /q c:\\windows',
  'rd /s /q c:\\users',
  'bcdedit /delete',
  'diskpart',
  'reg delete hklm\\system',
  'reg delete hklm\\software',
  'mimikatz',
  'lazagne',
  'kill -9 -1',
];

export const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)/i,
  /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /new\s+instructions?:\s*/i,
  /system\s*:\s*/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<\s*SYS\s*>>/i,
  /act\s+as\s+(a|an|if)\s+/i,
  /pretend\s+(to\s+be|you\s+are)\s+/i,
  /roleplay\s+as\s+/i,
  /override\s+(safety|security|rules?|instructions?|filters?)/i,
  /bypass\s+(safety|security|rules?|instructions?|filters?)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode\s+(enabled|on|activated)/i,
  /reveal\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?|message)/i,
  /what\s+(are|is)\s+your\s+(system|initial|original)\s+(prompt|instructions?|message)/i,
  /output\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)/i,
  /repeat\s+(your|the)\s+.*(prompt|instructions?)\s*(back|verbatim|exactly)/i,
  /base64\s*decode/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /\\x[0-9a-fA-F]{2}/,
  /&#x?[0-9a-fA-F]+;/,
];
