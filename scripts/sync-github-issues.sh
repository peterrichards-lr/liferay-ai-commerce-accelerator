#!/usr/bin/env bash
# Scripts to create, link, and sync GitHub issues for the ePIM refactor and SDK standalone split.
# This script is designed to run in the user's interactive terminal where the GitHub CLI (gh) is authenticated.

set -e

# Exit early if executed inside the Docker container (as Liferay entrypoint runs all scripts in /mnt/liferay/scripts)
if [ -f /.dockerenv ] || [ -n "$LIFERAY_HOME" ]; then
    echo "ℹ  Exiting early: sync-github-issues.sh is a host-side script, not meant to be run inside the Liferay container."
    if [ "${BASH_SOURCE[0]}" != "$0" ]; then
        return 0 2>/dev/null || exit 0
    else
        exit 0
    fi
fi

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== Liferay AI Commerce Accelerator Issue Sync ===${NC}"

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo -e "${YELLOW}Warning: GitHub CLI (gh) not found in PATH.${NC}"
    echo "Please install it via 'brew install gh' or download it from https://cli.github.com/."
    exit 1
fi

# Check authentication
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}Warning: GitHub CLI is not authenticated.${NC}"
    echo "Please run 'gh auth login' in your terminal and then execute this script again."
    exit 1
fi

# Get current Git commit to reference
COMMIT_REF=$(git rev-parse --short HEAD 2>/dev/null || echo "master")
echo -e "Referencing commit: ${BLUE}${COMMIT_REF}${NC}"

# ==========================================
# 1. PIM Refactoring (ePIM) Epic & Sub-issues
# ==========================================
echo -e "\n${GREEN}[1/2] Syncing Liferay PIM Integration Issues...${NC}"

# Create Parent Epic
EPIM_EPIC_BODY=$(cat <<EOF
Liferay is introducing a standalone **Liferay PIM** (expected in Q3/Q4). As clarified by product leadership, this PIM will **not** replace the existing Liferay Commerce product management system. Instead:

1. **Coexistence**: Liferay Commerce's product catalog APIs (\`/o/headless-commerce-admin-catalog/v1.0\`) will continue to exist as-is to power shopping, inventory, and checkout.
2. **PIM Connector**: Liferay PIM will manage product trees and SKUs independently, and use a PIM-to-Commerce connector to push/sync data into Commerce products.

This means AICA has two execution modes depending on the target DXP environment setup:
- **Direct-to-Commerce (Legacy/Standard Mode)**: Seeds B2B datasets directly into Commerce APIs (for classic setups).
- **PIM-centric (PIM Mode)**: Seeds B2B datasets into the new Liferay PIM APIs, showing the full enterprise flow where PIM ingests AI data and syncs it to Commerce.

To support both modes dynamically and ensure backward compatibility, we will refactor the SDK's catalog layer using the **Adapter Pattern**.
EOF
)

echo "Creating Parent Epic Issue..."
EPIM_EPIC_URL=$(gh issue create \
    --title "[PIM Refactor] Support standalone Liferay PIM and dynamic Catalog/PIM Seeding via SDK Adapters" \
    --body "$EPIM_EPIC_BODY" \
    --label "enhancement")
EPIM_EPIC_NUM=$(echo "$EPIM_EPIC_URL" | grep -oE "[0-9]+$")
echo -e "Epic created: ${GREEN}Issue #${EPIM_EPIC_NUM}${NC} ($EPIM_EPIC_URL)"

# Sub-issues helper
create_sub_issue() {
    local title="$1"
    local body="$2"
    local completed="$3"
    
    echo "Creating sub-issue: $title..."
    local issue_url=$(gh issue create \
        --title "$title" \
        --body "$body (Belongs to Epic #$EPIM_EPIC_NUM)" \
        --label "enhancement")
    local issue_num=$(echo "$issue_url" | grep -oE "[0-9]+$")
    
    if [ "$completed" = "true" ]; then
        echo -e "Closing completed Issue #${issue_num} with commit reference..."
        gh issue comment "$issue_num" --body "This issue was successfully implemented and verified in commit $COMMIT_REF. Closing."
        gh issue close "$issue_num"
    fi
}

# Sub-Issue 1 (Completed)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #1: Refactor Path Resolution into Configuration Route Profiles" \
    "Decouple the static URL paths in liferayPaths.cjs so they can vary based on version profiles (e.g. legacy vs. pim)." \
    "true"

# Sub-Issue 2 (Completed)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #2: Define LiferayCatalogAdapter Interface and Legacy Implementation" \
    "Establish a generic Catalog interface inside the SDK to isolate catalog CRUD operations, implement LegacyProductFirstAdapter, and delegate calls in index.cjs." \
    "true"

# Sub-Issue 3 (Completed)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #3: Implement Auto-Discovery Capability Detection Factory" \
    "Enable the SDK to automatically detect which version of Liferay's catalog endpoints is active via a non-blocking startup check." \
    "true"

# Sub-Issue 4 (Completed)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #4: Decouple productGenerator and deleteProducts from direct REST endpoints" \
    "Ensure B2B generation and teardown flows operate strictly through the SDK's abstract methods instead of directly calling REST routes." \
    "true"

# Sub-Issue 5 (Open)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #5: Develop PimSkuFirstAdapter (upon OpenAPI specification release)" \
    "Implement the SKU-first tree adapter mapping generic catalog operations to Liferay PIM's tree-based endpoints once Q3/Q4 specs are published." \
    "false"

# Sub-Issue 6 (Open)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #6: Update AI Generation Prompts & Schemas for Tree Formats" \
    "Refactor the prompt generation and schema files to instruct LLMs to shape B2B data in SKU-first tree formats." \
    "false"

# Sub-Issue 7 (Open)
create_sub_issue \
    "[PIM Refactor] Sub-Issue #7: End-to-End Test and Validation Suite" \
    "Update Playwright E2E suite to run tests against both standard Commerce (Product-first) and PIM-enabled DXP instances." \
    "false"


# ==========================================
# 2. SDK Standalone Split Epic & Sub-issues
# ==========================================
echo -e "\n${GREEN}[2/2] Syncing SDK Standalone Split Issues...${NC}"

SDK_EPIC_BODY=$(cat <<EOF
To enable reusing the @liferay/accelerator-sdk across different Liferay accelerator projects (such as CMS, Forms, or generic Portal integrations) and to develop AI-agent-focused interfaces (like MCP servers and JSON-RPC sidecars) safely without affecting the commerce accelerator monorepo, we will extract the SDK into its own standalone repository.
EOF
)

echo "Creating SDK Split Epic Issue..."
SDK_EPIC_URL=$(gh issue create \
    --title "[SDK Split] Extract @liferay/accelerator-sdk into a standalone repository and publish to npm registry" \
    --body "$SDK_EPIC_BODY" \
    --label "enhancement")
SDK_EPIC_NUM=$(echo "$SDK_EPIC_URL" | grep -oE "[0-9]+$")
echo -e "Epic created: ${GREEN}Issue #${SDK_EPIC_NUM}${NC} ($SDK_EPIC_URL)"

create_sdk_sub_issue() {
    local title="$1"
    local body="$2"
    
    echo "Creating SDK sub-issue: $title..."
    gh issue create \
        --title "$title" \
        --body "$body (Belongs to Epic #$SDK_EPIC_NUM)" \
        --label "enhancement"
}

# Sub-Issue 1 (Open)
create_sdk_sub_issue \
    "[SDK Split] Sub-Issue #1: Initialize Standalone SDK Repository" \
    "Setup new standalone Git repository structure, configure ignoring patterns, and verify local unit test execution."

# Sub-Issue 2 (Open)
create_sdk_sub_issue \
    "[SDK Split] Sub-Issue #2: Setup CI/CD Workflows & Registry Publishing" \
    "Create GitHub Actions workflow to run lint, test, and automatically publish tags/releases to NPM registry."

# Sub-Issue 3 (Open)
create_sdk_sub_issue \
    "[SDK Split] Sub-Issue #3: Update Commerce Accelerator Monorepo to Use Published SDK" \
    "Remove the local SDK directory, update Yarn workspaces, and import @liferay/accelerator-sdk from the registry."

# Sub-Issue 4 (Open)
create_sdk_sub_issue \
    "[SDK Split] Sub-Issue #4: Implement Standalone MCP Server & CLI Tooling" \
    "Install @modelcontextprotocol/sdk and create bin/mcp-server.cjs to expose SDK REST and GraphQL operations as MCP tools."

echo -e "\n${GREEN}All issues successfully created and synced!${NC}"
