import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:NetworkEgress');

// ─── S9: Network Egress Control ───
// Controls which domains/IPs the agent can make outbound connections to.
// Two modes: blocklist (default — block known-bad, allow everything else)
//            allowlist (strict — only allow explicitly approved domains)

// Known malicious/suspicious domain patterns
const DEFAULT_BLOCKED_DOMAINS = [
  // Common exfiltration/data collection services
  'requestbin.com',
  'webhook.site',
  'hookbin.com',
  'pipedream.com',
  'beeceptor.com',
  'requestcatcher.com',
  'canarytokens.com',
  'interact.sh',
  'interactsh.com',
  'burpcollaborator.net',
  'oastify.com',
  // DNS exfiltration
  'dnslog.cn',
  'ceye.io',
  // Pastebin-like (data exfiltration targets)
  'pastebin.com',
  'paste.ee',
  'dpaste.com',
  'hastebin.com',
  'ghostbin.com',
  // File sharing (exfiltration targets)
  'transfer.sh',
  'file.io',
  '0x0.st',
  'temp.sh',
  // Reverse shell / C2 infrastructure patterns
  'ngrok.io',
  'ngrok-free.app',
  'serveo.net',
  'localhost.run',
  'localtunnel.me',
];

// Internal/metadata IPs that should never be accessed (cloud SSRF prevention)
const BLOCKED_IP_PATTERNS = [
  /^169\.254\.\d+\.\d+$/,            // AWS metadata / link-local
  /^100\.100\.100\.200$/,             // Alibaba Cloud metadata
  /^192\.0\.0\.\d+$/,                // IETF reserved
  /^0\.0\.0\.0$/,                     // All interfaces
  /^127\.\d+\.\d+\.\d+$/,            // Loopback (block for outbound exfiltration, NOT for local dev)
];

// Cloud metadata endpoints (SSRF targets)
const BLOCKED_METADATA_PATHS = [
  '/latest/meta-data',                // AWS
  '/metadata/v1',                     // DigitalOcean
  '/computeMetadata/v1',              // GCP
  '/metadata/instance',               // Azure
  '/opc/v2/instance',                 // Oracle Cloud
];

export interface NetworkEgressConfig {
  enabled: boolean;
  mode: 'blocklist' | 'allowlist';
  blockedDomains: string[];
  allowedDomains: string[];       // only used in allowlist mode
  blockCloudMetadata: boolean;    // block cloud metadata endpoints (SSRF prevention)
  blockPrivateIPs: boolean;       // block outbound to private/internal IPs
}

const DEFAULT_CONFIG: NetworkEgressConfig = {
  enabled: true,
  mode: 'blocklist',
  blockedDomains: [...DEFAULT_BLOCKED_DOMAINS],
  allowedDomains: [],
  blockCloudMetadata: true,
  blockPrivateIPs: false,  // false by default because agent may need to access local services
};

export interface EgressCheckResult {
  allowed: boolean;
  reason?: string;
  domain?: string;
}

export class NetworkEgressControl {
  private config: NetworkEgressConfig;

  constructor(config?: Partial<NetworkEgressConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if an outbound request to the given URL should be allowed.
   */
  checkUrl(url: string): EgressCheckResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: 'Invalid URL' };
    }

    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // Block non-HTTP protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { allowed: false, reason: `Protocol "${parsed.protocol}" is not allowed. Only http/https.`, domain: hostname };
    }

    // Block cloud metadata endpoints (SSRF prevention)
    if (this.config.blockCloudMetadata) {
      for (const metaPath of BLOCKED_METADATA_PATHS) {
        if (pathname.startsWith(metaPath)) {
          logger.warn('BLOCKED cloud metadata access (SSRF)', { url, hostname, path: pathname });
          return { allowed: false, reason: 'Access to cloud metadata endpoints is blocked (SSRF prevention).', domain: hostname };
        }
      }
    }

    // Block internal/metadata IPs
    if (this.config.blockPrivateIPs) {
      for (const pattern of BLOCKED_IP_PATTERNS) {
        if (pattern.test(hostname)) {
          logger.warn('BLOCKED private IP access', { url, hostname });
          return { allowed: false, reason: `Access to private/internal IP "${hostname}" is blocked.`, domain: hostname };
        }
      }
    }

    // Always block metadata IPs regardless of blockPrivateIPs setting
    if (/^169\.254\.\d+\.\d+$/.test(hostname) || hostname === '100.100.100.200') {
      logger.warn('BLOCKED cloud metadata IP', { url, hostname });
      return { allowed: false, reason: `Access to cloud metadata IP "${hostname}" is blocked (SSRF prevention).`, domain: hostname };
    }

    if (this.config.mode === 'allowlist') {
      // Allowlist mode: only explicitly allowed domains pass
      const isAllowed = this.config.allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
      if (!isAllowed) {
        logger.info('Domain not in allowlist', { hostname });
        return { allowed: false, reason: `Domain "${hostname}" is not in the allowed list.`, domain: hostname };
      }
      return { allowed: true, domain: hostname };
    }

    // Blocklist mode: check against blocked domains
    for (const blocked of this.config.blockedDomains) {
      if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
        logger.warn('BLOCKED domain', { url, hostname, blockedDomain: blocked });
        return { allowed: false, reason: `Domain "${hostname}" is blocked (known exfiltration/tunneling service).`, domain: hostname };
      }
    }

    return { allowed: true, domain: hostname };
  }

  /**
   * Check a shell command for outbound network calls to blocked destinations.
   * Extracts URLs from curl/wget/fetch commands and checks them.
   */
  checkShellCommand(command: string): EgressCheckResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    // Extract URLs from common network commands
    const urlPatterns = [
      /(?:curl|wget|fetch|http|https)\s+["']?(https?:\/\/[^\s"']+)/gi,
      /(?:curl|wget)\s+(?:-[^\s]+\s+)*["']?(https?:\/\/[^\s"']+)/gi,
      /(?:invoke-webrequest|invoke-restmethod|iwr|irm)\s+["']?(https?:\/\/[^\s"']+)/gi,
      /(?:scp|rsync)\s+.*\s+\S+@([^\s:]+):/gi,
      /(?:nc|ncat|netcat|socat)\s+(?:-[^\s]+\s+)*([^\s]+)\s+\d+/gi,
    ];

    for (const pattern of urlPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const extracted = match[1];
        if (!extracted) continue;

        // If it looks like a URL, check it directly
        if (extracted.startsWith('http://') || extracted.startsWith('https://')) {
          const result = this.checkUrl(extracted);
          if (!result.allowed) return result;
        } else {
          // It's a hostname — check it against blocked domains
          const hostname = extracted.toLowerCase();
          for (const blocked of this.config.blockedDomains) {
            if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
              logger.warn('BLOCKED shell command to blocked domain', { command: command.substring(0, 200), hostname });
              return { allowed: false, reason: `Outbound connection to "${hostname}" is blocked.`, domain: hostname };
            }
          }
        }
      }
    }

    return { allowed: true };
  }

  addBlockedDomain(domain: string): void {
    const lower = domain.toLowerCase();
    if (!this.config.blockedDomains.includes(lower)) {
      this.config.blockedDomains.push(lower);
    }
  }

  removeBlockedDomain(domain: string): void {
    const lower = domain.toLowerCase();
    this.config.blockedDomains = this.config.blockedDomains.filter(d => d !== lower);
  }

  addAllowedDomain(domain: string): void {
    const lower = domain.toLowerCase();
    if (!this.config.allowedDomains.includes(lower)) {
      this.config.allowedDomains.push(lower);
    }
  }

  updateConfig(config: Partial<NetworkEgressConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): NetworkEgressConfig {
    return { ...this.config };
  }
}

export function createNetworkEgressControl(config?: Partial<NetworkEgressConfig>): NetworkEgressControl {
  return new NetworkEgressControl(config);
}
