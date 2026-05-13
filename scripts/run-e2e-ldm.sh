#!/bin/bash
# scripts/run-e2e-ldm.sh - AICA E2E Test Orchestrator using Liferay Docker Manager (LDM)

set -e

# --- Argument Parsing ---
VERBOSE=0
while getopts "v" opt; do
  case ${opt} in
    v )
      VERBOSE=1
      ;;
    \? )
      echo "Usage: $0 [-v]"
      exit 1
      ;;
  esac
done

# If verbose mode is enabled, let the user know
if [ $VERBOSE -eq 1 ]; then
  echo "🛠️  Verbose mode enabled. Realized commands will be displayed with [CMD]."
fi

# --- CI Check (Fail Fast/Quietly) ---
# This script is computationally heavy and requires a Docker environment with high RAM.
# We bypass it in CI/GitHub Actions to avoid blocking the pipeline.
if [ "$CI" = "true" ] || [ "$GITHUB_ACTIONS" = "true" ]; then
    echo "⏭️  SKIPPING LDM Orchestration: CI/GitHub Actions environment detected."
    exit 0
fi

# --- Constants ---
REQUIRED_LDM_VERSION="2.5.4"
PROJECT_NAME="aica-e2e"
DEFAULT_HOST="aica-e2e.local"
GRADLE_PROPS="gradle.properties"

# --- Logging Helpers ---
log_command() {
   if [ "$VERBOSE" -eq 1 ]; then
      echo -e "\033[0;34m[CMD]\033[0m $*"
   fi
}

# Log and run LDM commands for replication visibility
ldm_cmd() {
    log_command "ldm $*"
    ldm "$@"
}

version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" == "$1" ]
}

echo "🚀 Starting AICA E2E Orchestration..."

# --- Phase 1: Environment Verification ---

if ! command -v ldm &> /dev/null; then
    echo "❌ ERROR: 'ldm' command not found in PATH."
    echo "🔗 Install it from: https://github.com/peterrichards-lr/liferay-docker-manager"
    exit 1
fi

CURRENT_LDM_VERSION=$(ldm --version | awk '{print $2}')
if ! version_ge "$REQUIRED_LDM_VERSION" "$CURRENT_LDM_VERSION"; then
    echo "❌ ERROR: LDM version $CURRENT_LDM_VERSION is too old. Need >= $REQUIRED_LDM_VERSION."
    exit 1
fi

# Hostname Resolution Check (Fail Fast)
if ! host "$DEFAULT_HOST" &> /dev/null && ! grep -q "$DEFAULT_HOST" /etc/hosts; then
    echo "❌ ERROR: Hostname '$DEFAULT_HOST' does not resolve."
    echo "💡 ACTION REQUIRED: Run the following command to fix your hosts file, then restart this script:"
    echo "   sudo ldm fix-hosts $DEFAULT_HOST"
    exit 1
fi

echo "🔍 Running LDM Doctor (Silent)..."
if ! ldm_cmd doctor --skip-project > /dev/null; then
    echo "❌ ERROR: Environment check failed. Run 'ldm doctor' manually."
    exit 1
fi

# --- Phase 2: Project Init & Start ---

if [ ! -f "$GRADLE_PROPS" ]; then
    echo "❌ ERROR: $GRADLE_PROPS not found."
    exit 1
fi

LIFERAY_TAG=$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)

echo "📦 Initializing LDM project [$PROJECT_NAME] (Hypersonic)..."
# init-from parameters: source project flags
ldm_cmd init-from . "$PROJECT_NAME" \
    --host-name "$DEFAULT_HOST" \
    --db hypersonic \
    --no-captcha \
    --non-interactive

echo "⚡ Starting Liferay container with tag [$LIFERAY_TAG] (Detached + Sidecar)..."
ldm_cmd run "$PROJECT_NAME" \
    --tag "$LIFERAY_TAG" \
    --detach \
    --sidecar \
    --no-captcha \
    --non-interactive

# --- Phase 3: Build & Deploy ---

echo "🔨 Phase 3: Building AICA Client Extensions..."
log_command "./gradlew deploy"
./gradlew deploy

echo "🚚 Syncing artifacts to container..."
ldm_cmd deploy "$PROJECT_NAME" --non-interactive

# --- Phase 4: Wait for Ready ---

echo "⏳ Waiting for Liferay to be ready at https://$DEFAULT_HOST..."
MAX_RETRIES=60
RETRY_COUNT=0
READY=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Use -k for insecure (mkcert) and check for 200/302 status
    STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "https://$DEFAULT_HOST" || echo "000")
    
    if [ "$STATUS" == "200" ] || [ "$STATUS" == "302" ]; then
        echo -e "\n✅ Liferay is UP and responding (Status: $STATUS)!"
        READY=1
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    printf "."
    sleep 10
done

if [ $READY -eq 0 ]; then
    echo -e "\n❌ ERROR: Liferay failed to become ready within $((MAX_RETRIES * 10 / 60)) minutes."
    ldm_cmd logs "$PROJECT_NAME" --tail 100
    exit 1
fi

# --- Phase 5: Test Execution & Teardown ---

echo "🎭 Phase 5: Running Playwright E2E tests..."

# Ensure we clean up even if the tests fail or the script is interrupted
cleanup() {
    echo -e "\n🧹 Cleaning up environment..."
    # Using ldm rm --delete to remove the project and its associated volumes/data
    ldm_cmd rm "$PROJECT_NAME" --delete --non-interactive || true
    echo "✨ Done."
}

# Register the cleanup trap
trap cleanup EXIT

# Set the base URL for Playwright
export BASE_URL="https://$DEFAULT_HOST"

# Execute the tests using the root verification script
log_command "yarn verification"
if yarn verification; then
    echo "-------------------------------------------------------"
    echo "🎉 SUCCESS: E2E Verification passed!"
    echo "-------------------------------------------------------"
    echo "💡 Visual Snapshots: Check the 'test-results' directory"
    echo "   to manually verify component display across devices."
else
    echo "-------------------------------------------------------"
    echo "❌ FAILURE: E2E Verification failed."
    echo "-------------------------------------------------------"
    # Capture short log burst for quick diagnosis before cleanup
    ldm_cmd logs "$PROJECT_NAME" --tail 50 || true
    echo "💡 Debugging: Check 'test-results' for failure snapshots."
    exit 1
fi
