#!/bin/bash
# scripts/run-e2e-ldm.sh - AICA E2E Test Orchestrator using Liferay Docker Manager (LDM)
# Phase 1: Environment Verification and Project Initialization

set -e

# --- Constants ---
REQUIRED_LDM_VERSION="2.5.4"
PROJECT_NAME="aica-e2e"
DEFAULT_HOST="aica-e2e.local"
GRADLE_PROPS="gradle.properties"

echo "🚀 Starting AICA E2E Orchestration..."

# --- Helper: Version Comparison ---
version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" == "$1" ]
}

# --- 1. Dependency Check (Fail Fast) ---
if ! command -v ldm &> /dev/null; then
    echo "❌ ERROR: 'ldm' command not found in PATH."
    echo "🔗 Install it from: https://github.com/peterrichards-lr/liferay-docker-manager"
    exit 1
fi

CURRENT_LDM_VERSION=$(ldm version | head -n 1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if ! version_ge "$REQUIRED_LDM_VERSION" "$CURRENT_LDM_VERSION"; then
    echo "❌ ERROR: LDM version $CURRENT_LDM_VERSION is too old."
    echo "💡 Minimum required version: $REQUIRED_LDM_VERSION. Please run 'ldm upgrade'."
    exit 1
fi

echo "🔍 Running LDM Doctor diagnostics..."
# We run doctor once to check everything. Redirecting stdout to keep it clean, but showing stderr.
if ! ldm doctor > /dev/null; then
    echo "❌ ERROR: Environment check failed. Please run 'ldm doctor' to fix resource or tool issues."
    exit 1
fi

# --- 2. Version Parsing ---
if [ ! -f "$GRADLE_PROPS" ]; then
    echo "❌ ERROR: $GRADLE_PROPS not found in project root."
    exit 1
fi

LIFERAY_TAG=$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)
if [ -z "$LIFERAY_TAG" ]; then
    echo "❌ ERROR: Could not parse 'liferay.workspace.product' from $GRADLE_PROPS."
    exit 1
fi

echo "✅ Verified: LDM $CURRENT_LDM_VERSION and Liferay Tag: $LIFERAY_TAG"

# --- 3. Project Initialization ---
echo "📦 Initializing LDM project [$PROJECT_NAME] from current workspace..."
# Using --force to ensure the link is fresh
ldm init-from . --project "$PROJECT_NAME" --host-name "$DEFAULT_HOST" --force

# --- 4. Environment Boot ---
echo "⚡ Starting Liferay container (Detached) with tag: $LIFERAY_TAG"
# We use --detach so the script can proceed to Phase 2 (Build & Wait) in the next iteration.
ldm run "$PROJECT_NAME" --tag "$LIFERAY_TAG" --detach

# --- Phase 1: Environment Verification and Project Initialization ---
# (Already implemented)
# ... (rest of logic) ...

# --- Phase 2: Build, Deploy and Wait ---
# (Already implemented)

# --- Phase 3: Test Execution & Teardown ---

echo "🎭 Phase 3: Running Playwright E2E tests..."

# Ensure we clean up even if the tests fail or the script is interrupted
cleanup() {
    echo -e "\n🧹 Cleaning up environment..."
    # Using ldm rm --delete to remove the project and its associated volumes/data
    ldm rm "$PROJECT_NAME" --delete || echo "⚠️ Warning: Cleanup failed or project already removed."
    echo "✨ Done."
}

# Register the cleanup trap
trap cleanup EXIT

# Set the base URL for Playwright
export BASE_URL="https://$DEFAULT_HOST"

# Execute the tests
if yarn playwright test; then
    echo "-------------------------------------------------------"
    echo "🎉 SUCCESS: E2E Verification passed!"
    echo "-------------------------------------------------------"
else
    echo "-------------------------------------------------------"
    echo "❌ FAILURE: E2E Verification failed."
    echo "-------------------------------------------------------"
    # Capture short log burst for quick diagnosis before cleanup
    ldm logs "$PROJECT_NAME" --tail 50 || true
    exit 1
fi
