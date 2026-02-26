#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# ForgeAI — Domain Setup Script
# Configures a custom domain with automatic HTTPS for ForgeAI.
# Uses Caddy reverse proxy with Let's Encrypt certificates.
#
# Usage: bash scripts/setup-domain.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════╗"
echo "║       ForgeAI — Domain Setup                 ║"
echo "║       Automatic HTTPS with Caddy             ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Check prerequisites ─────────────────────────────
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not available. Please install Docker Compose.${NC}"
    exit 1
fi

# ─── Detect project directory ────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

echo -e "${CYAN}Project directory:${NC} $PROJECT_DIR"
echo ""

# ─── Get domain from user ────────────────────────────
read -rp "$(echo -e "${BOLD}Enter your domain (e.g., ai.example.com):${NC} ")" DOMAIN

if [[ -z "$DOMAIN" ]]; then
    echo -e "${RED}✗ Domain cannot be empty.${NC}"
    exit 1
fi

# Basic domain validation
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$ ]]; then
    echo -e "${RED}✗ Invalid domain format: ${DOMAIN}${NC}"
    echo -e "  Expected format: subdomain.example.com or example.com"
    exit 1
fi

echo ""
echo -e "${YELLOW}⚠  Before continuing, make sure:${NC}"
echo -e "  1. You own the domain ${BOLD}${DOMAIN}${NC}"
echo -e "  2. DNS A record points to this server's public IP"
echo -e "  3. Ports 80 and 443 are open in your firewall"
echo ""

# ─── Check DNS resolution ────────────────────────────
echo -e "${CYAN}Checking DNS resolution...${NC}"

SERVER_IP=""
if command -v curl &> /dev/null; then
    SERVER_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
fi

DOMAIN_IP=""
if command -v dig &> /dev/null; then
    DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | head -n1 || echo "")
elif command -v nslookup &> /dev/null; then
    DOMAIN_IP=$(nslookup "$DOMAIN" 2>/dev/null | awk '/^Address: / { print $2 }' | head -n1 || echo "")
elif command -v host &> /dev/null; then
    DOMAIN_IP=$(host "$DOMAIN" 2>/dev/null | awk '/has address/ { print $4 }' | head -n1 || echo "")
fi

if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" ]]; then
    if [[ "$SERVER_IP" == "$DOMAIN_IP" ]]; then
        echo -e "${GREEN}✓ DNS OK: ${DOMAIN} → ${DOMAIN_IP} (matches this server)${NC}"
    else
        echo -e "${YELLOW}⚠ DNS mismatch: ${DOMAIN} → ${DOMAIN_IP}, but this server is ${SERVER_IP}${NC}"
        echo -e "  This may cause SSL certificate issues."
        read -rp "Continue anyway? (y/N): " CONTINUE
        if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
            echo -e "${RED}Aborted. Fix DNS and try again.${NC}"
            exit 1
        fi
    fi
elif [[ -n "$DOMAIN_IP" ]]; then
    echo -e "${GREEN}✓ DNS resolves: ${DOMAIN} → ${DOMAIN_IP}${NC}"
else
    echo -e "${YELLOW}⚠ Could not verify DNS for ${DOMAIN}. Make sure it points to this server.${NC}"
    read -rp "Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Aborted.${NC}"
        exit 1
    fi
fi

echo ""

# ─── Check firewall ports ────────────────────────────
echo -e "${CYAN}Checking ports 80 and 443...${NC}"

PORT_80_USED=false
PORT_443_USED=false

if command -v ss &> /dev/null; then
    ss -tlnp 2>/dev/null | grep -q ':80 ' && PORT_80_USED=true
    ss -tlnp 2>/dev/null | grep -q ':443 ' && PORT_443_USED=true
elif command -v netstat &> /dev/null; then
    netstat -tlnp 2>/dev/null | grep -q ':80 ' && PORT_80_USED=true
    netstat -tlnp 2>/dev/null | grep -q ':443 ' && PORT_443_USED=true
fi

if [[ "$PORT_80_USED" == "true" ]] || [[ "$PORT_443_USED" == "true" ]]; then
    echo -e "${YELLOW}⚠ Warning: Port 80 or 443 is already in use.${NC}"
    echo -e "  Caddy needs these ports for HTTPS. You may need to stop other services (nginx, apache, etc)."
    read -rp "Continue? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Aborted. Free ports 80/443 and try again.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Ports 80 and 443 are available${NC}"
fi

echo ""

# ─── Configure .env ──────────────────────────────────
echo -e "${CYAN}Configuring .env...${NC}"

# Create .env if it doesn't exist
touch "$ENV_FILE"

# Update or add DOMAIN
if grep -q "^DOMAIN=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" "$ENV_FILE"
else
    echo "DOMAIN=${DOMAIN}" >> "$ENV_FILE"
fi

# Update or add PUBLIC_URL
PUBLIC_URL="https://${DOMAIN}"
if grep -q "^PUBLIC_URL=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=${PUBLIC_URL}|" "$ENV_FILE"
else
    echo "PUBLIC_URL=${PUBLIC_URL}" >> "$ENV_FILE"
fi

echo -e "${GREEN}✓ DOMAIN=${DOMAIN}${NC}"
echo -e "${GREEN}✓ PUBLIC_URL=${PUBLIC_URL}${NC}"

echo ""

# ─── Verify Caddyfile exists ─────────────────────────
if [[ ! -f "$PROJECT_DIR/Caddyfile" ]]; then
    echo -e "${RED}✗ Caddyfile not found at ${PROJECT_DIR}/Caddyfile${NC}"
    echo -e "  Please make sure you're running this from the ForgeAI project root."
    exit 1
fi

echo -e "${GREEN}✓ Caddyfile found${NC}"

# ─── Summary and confirmation ────────────────────────
echo ""
echo -e "${CYAN}${BOLD}═══ Setup Summary ═══${NC}"
echo -e "  Domain:     ${BOLD}${DOMAIN}${NC}"
echo -e "  HTTPS:      ${GREEN}Automatic (Let's Encrypt via Caddy)${NC}"
echo -e "  Public URL: ${BOLD}${PUBLIC_URL}${NC}"
echo -e "  Sites URL:  ${BOLD}${PUBLIC_URL}/sites/<project>/index.html${NC}"
echo -e "  Dashboard:  ${BOLD}${PUBLIC_URL}/settings${NC}"
echo ""
echo -e "${YELLOW}This will:${NC}"
echo -e "  1. Rebuild the Gateway container"
echo -e "  2. Start Caddy reverse proxy with automatic HTTPS"
echo -e "  3. Obtain SSL certificate from Let's Encrypt"
echo ""

read -rp "$(echo -e "${BOLD}Proceed? (y/N):${NC} ")" PROCEED

if [[ ! "$PROCEED" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Aborted. Settings saved to .env — run this script again when ready.${NC}"
    exit 0
fi

echo ""

# ─── Deploy ──────────────────────────────────────────
echo -e "${CYAN}Building and starting ForgeAI with domain support...${NC}"
echo ""

cd "$PROJECT_DIR"

# Pull latest changes if git repo
if [[ -d ".git" ]]; then
    echo -e "${CYAN}Pulling latest changes...${NC}"
    git pull origin dev 2>/dev/null || true
fi

# Build and start with domain profile
echo -e "${CYAN}Starting containers with domain profile...${NC}"
docker compose --profile domain up -d --build

echo ""

# ─── Wait for health ─────────────────────────────────
echo -e "${CYAN}Waiting for services to start...${NC}"

for i in {1..30}; do
    if curl -sf "http://localhost:18800/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Gateway is healthy${NC}"
        break
    fi
    sleep 2
    echo -n "."
done

# Check Caddy
sleep 3
if docker ps | grep -q forgeai-caddy; then
    echo -e "${GREEN}✓ Caddy is running${NC}"
else
    echo -e "${YELLOW}⚠ Caddy container may still be starting...${NC}"
fi

echo ""

# ─── Final output ────────────────────────────────────
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════╗"
echo "║       ✓ ForgeAI is live!                     ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Dashboard:${NC}  ${PUBLIC_URL}/settings"
echo -e "  ${BOLD}Chat API:${NC}   ${PUBLIC_URL}/api/chat"
echo -e "  ${BOLD}Sites:${NC}      ${PUBLIC_URL}/sites/<project>/"
echo -e "  ${BOLD}Health:${NC}     ${PUBLIC_URL}/health"
echo ""
echo -e "${CYAN}SSL certificate will be automatically obtained on first request.${NC}"
echo -e "${CYAN}If you see a certificate warning, wait 30 seconds and refresh.${NC}"
echo ""
echo -e "${YELLOW}To remove domain and go back to IP access:${NC}"
echo -e "  1. Remove DOMAIN from .env"
echo -e "  2. Run: docker compose --profile domain down"
echo -e "  3. Run: docker compose up -d"
echo ""
