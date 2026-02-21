# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.1.x   | ✅ Active support  |
| 1.0.x   | ⚠️ Security fixes only |

## Reporting a Vulnerability

**⚠️ Please do NOT open a public GitHub issue for security vulnerabilities.**

We take security seriously. If you discover a vulnerability, please report it responsibly:

### How to Report

1. **Email:** Send a detailed report to **security@forgeai.dev**
2. **Subject:** `[SECURITY] Brief description of the vulnerability`
3. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Affected versions
   - Potential impact
   - Suggested fix (if any)

### What to Expect

| Timeframe | Action |
|-----------|--------|
| **24 hours** | We acknowledge receipt of your report |
| **72 hours** | We provide an initial assessment |
| **7 days** | We aim to have a fix or mitigation plan |
| **30 days** | We publicly disclose (coordinated with reporter) |

### Scope

The following are **in scope** for security reports:

- Authentication bypass or escalation
- Remote code execution (RCE)
- SQL injection / NoSQL injection
- Cross-site scripting (XSS)
- Server-side request forgery (SSRF)
- Sensitive data exposure (API keys, tokens, credentials)
- Denial of service (DoS) via application logic
- Dependency vulnerabilities with exploitable impact

The following are **out of scope**:

- Self-hosted instances with intentionally disabled security features
- Vulnerabilities in third-party services (report to them directly)
- Social engineering attacks
- Physical access attacks

### Safe Harbor

We support responsible disclosure. If you follow this policy in good faith:

- We will **not** pursue legal action against you
- We will work with you to understand and resolve the issue
- We will credit you in the advisory (unless you prefer anonymity)

## Security Architecture

ForgeAI implements multiple layers of security:

### Authentication
- **3-Factor Authentication** — Access token + Admin PIN + TOTP
- **JWT sessions** with configurable expiration
- **Rate limiting** on authentication endpoints

### CI/CD Security Gate
Every pull request is automatically scanned for:
- **Dependency vulnerabilities** (`pnpm audit`)
- **Secret leaks** (Gitleaks)
- **Static code analysis** (CodeQL)
- **Backdoor patterns** (eval, reverse shells, crypto mining, env exfiltration)
- **Lockfile integrity** (tamper detection)
- **Suspicious file types** (executables, .env files)

### Runtime Security
- **XSS prevention** — HTML escaping in all rendered templates
- **JWT validation** — Format verification before processing
- **IP-based rate limiting** — Brute-force protection
- **Vault encryption** — AES-256-GCM for stored secrets
- **No `eval()` policy** — Enforced by CI

## Security Checklist for Contributors

Before submitting a PR, ensure:

- [ ] No `eval()` or `new Function()` usage
- [ ] No hardcoded credentials, IPs, or tokens
- [ ] No new `child_process` usage outside approved tool files
- [ ] No obfuscated or minified code committed to source
- [ ] Dependencies added are well-known and actively maintained
- [ ] `pnpm-lock.yaml` changes correspond to `package.json` changes
- [ ] No `.env` files or secrets in the PR

---

Thank you for helping keep ForgeAI secure! 🔒
