#!/bin/bash
#
#
# Test script for IMAP API mailcow addon
# Validates the installation and basic functionality
#

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

function test_ok() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED=$((PASSED+1))
}
function test_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    FAILED=$((FAILED+1))
}

function test_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

echo "=========================================="
echo "IMAP API Mailcow Addon - Validation Test"
echo "=========================================="
echo ""

# Test 1: Check required files exist
echo "Test 1: Checking required files..."
FILES=(

    "docker-compose.yml"
    "docker-compose.mailcow-addon.yml.example"
    "Dockerfile"
    "server.js"
    "package.json"
    "install-mailcow-addon.sh"
    "config/imapapi-addon.toml"
    "workers/api.js"
    "workers/imap.js"
    "MAILCOW_ADDON_README.md"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        test_ok "File exists: $file"
    else
        test_fail "File missing: $file"
    fi
done
echo ""

# Test 2: Check Dockerfile syntax
echo "Test 2: Checking Dockerfile syntax..."
if grep -q "FROM node:" Dockerfile && grep -q "WORKDIR" Dockerfile && grep -q "CMD" Dockerfile; then
    test_ok "Dockerfile has required instructions"
else
    test_fail "Dockerfile may be incomplete"
fi

if grep -q "wget" Dockerfile; then
    test_ok "Dockerfile includes wget for health checks"
else
    test_warning "Dockerfile doesn't include wget (needed for health checks)"
fi
echo ""

# Test 3: Check docker-compose files
echo "Test 3: Checking docker-compose files..."
if grep -q "imapapi-mailcow" docker-compose.mailcow-addon.yml.example; then
    test_ok "docker-compose.mailcow-addon.yml.example has service definition"
else
    test_fail "docker-compose.mailcow-addon.yml.example missing service"
fi

if grep -q "redis-mailcow" docker-compose.mailcow-addon.yml.example; then
    test_ok "docker-compose references redis-mailcow"
else
    test_fail "docker-compose doesn't reference redis-mailcow"
fi

if grep -q "healthcheck" docker-compose.mailcow-addon.yml.example; then
    test_ok "docker-compose has healthcheck configured"
else
    test_fail "docker-compose missing healthcheck"
fi
echo ""

# Test 4: Check API health endpoint
echo "Test 4: Checking API health endpoint..."
if grep -q "path: '/health'" workers/api.js; then
    test_ok "Health endpoint is defined"
else
    test_fail "Health endpoint not found"
fi

if grep -q "redis.smembers" workers/api.js; then
    test_ok "Health endpoint checks Redis"
else
    test_warning "Health endpoint may not check Redis"
fi
echo ""

# Test 5: Check installation script
echo "Test 5: Checking installation script..."
if [ -x "install-mailcow-addon.sh" ]; then
    test_ok "Installation script is executable"
else
    test_fail "Installation script is not executable"
fi

if grep -q "docker compose" install-mailcow-addon.sh; then
    test_ok "Installation script uses docker compose"
else
    test_fail "Installation script doesn't use docker compose"
fi

if grep -q "mailcow.conf" install-mailcow-addon.sh; then
    test_ok "Installation script updates mailcow.conf"
else
    test_fail "Installation script doesn't update mailcow.conf"
fi

if grep -q "IMAPAPI_" install-mailcow-addon.sh; then
    test_ok "Installation script sets IMAPAPI variables"
else
    test_fail "Installation script doesn't set IMAPAPI variables"
fi
echo ""

# Test 6: Check configuration
echo "Test 6: Checking configuration files..."
if grep -q "redis = " config/imapapi-addon.toml; then
    test_ok "Addon config has Redis configuration"
else
    test_fail "Addon config missing Redis configuration"
fi

if grep -q 'host = "0.0.0.0"' config/imapapi-addon.toml; then
    test_ok "Addon config binds to all interfaces"
else
    test_fail "Addon config doesn't bind to all interfaces"
fi

if grep -q "port = 3000" config/imapapi-addon.toml; then
    test_ok "Addon config has correct port"
else
    test_fail "Addon config has incorrect port"
fi
echo ""

# Test 7: Check documentation
echo "Test 7: Checking documentation..."
if [ -f "MAILCOW_ADDON_README.md" ]; then
    if grep -q "mailcow" MAILCOW_ADDON_README.md; then
        test_ok "Mailcow documentation exists"
    else
        test_fail "Mailcow documentation incomplete"
    fi
else
    test_fail "Mailcow documentation missing"
fi

if [ -f "examples/mailcow-integration.md" ]; then
    test_ok "Integration guide exists"
else
    test_warning "Integration guide missing"
fi
echo ""

# Test 8: Check main README
if grep -q "Mailcow" README.md; then
    test_ok "Main README references mailcow"
else
    test_fail "Main README doesn't reference mailcow"
fi
echo ""

# Summary
echo "=========================================="
echo "Test Results"
echo "=========================================="
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi