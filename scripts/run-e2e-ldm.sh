#!/bin/bash
# scripts/run-e2e-ldm.sh - AICA E2E Test Orchestrator using Liferay Docker Manager (LDM)

set -e

# --- Argument Parsing ---
VERBOSE=0
PROJECT_NAME=""
EXISTING_PROJECT=0
KEEP_PROJECT=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -v|--verbose) VERBOSE=1 ;;
        -p|--project) PROJECT_NAME="$2"; EXISTING_PROJECT=1; shift ;;
        -k|--keep) KEEP_PROJECT=1 ;;
        *) echo "Usage: $0 [-v] [-k] [-p <project_name>]"; exit 1 ;;
    esac
    shift
done

# If verbose mode is enabled, let the user know
if [ $VERBOSE -eq 1 ]; then
  echo "🛠️  Verbose mode enabled. Realized commands will be displayed with [CMD]."
fi

if [ $KEEP_PROJECT -eq 1 ]; then
  echo "🛡️  Keep mode enabled. Ephemeral project will NOT be deleted after tests."
fi

# If no project specified, use default ephemeral one
if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME="aica-e2e"
    EXISTING_PROJECT=0
else
    echo "🏗️  Using existing LDM project: $PROJECT_NAME"
fi

# --- CI Check (Fail Fast/Quietly) ---
if [ "$CI" = "true" ] || [ "$GITHUB_ACTIONS" = "true" ]; then
    echo "⏭️  SKIPPING LDM Orchestration: CI/GitHub Actions environment detected."
    exit 0
fi

# --- Constants ---
REQUIRED_LDM_VERSION="2.5.4"
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

# Determine the target host
TARGET_HOST="$DEFAULT_HOST"
if [ $EXISTING_PROJECT -eq 1 ]; then
    # Try to resolve host from existing project config
    TARGET_HOST=$(ldm list | grep "^$PROJECT_NAME " | awk '{print $3}' || echo "")
    if [ -z "$TARGET_HOST" ]; then
        echo "❌ ERROR: Could not find host name for project '$PROJECT_NAME'. Is it initialized?"
        exit 1
    fi
fi

# Hostname Resolution Check
if ! host "$TARGET_HOST" &> /dev/null && ! grep -q "$TARGET_HOST" /etc/hosts; then
    echo "❌ ERROR: Hostname '$TARGET_HOST' does not resolve."
    echo "💡 ACTION REQUIRED: Run the following command to fix your hosts file, then restart this script:"
    echo "   ldm fix-hosts $TARGET_HOST"
    exit 1
fi

echo "🔍 Running LDM Doctor (Silent)..."
if ! ldm_cmd doctor --skip-project > /dev/null; then
    echo "❌ ERROR: Environment check failed. Run 'ldm doctor' manually."
    exit 1
fi

# --- Phase 2: Project Init & Start ---

if [ $EXISTING_PROJECT -eq 0 ]; then
    if [ ! -f "$GRADLE_PROPS" ]; then
        echo "❌ ERROR: $GRADLE_PROPS not found."
        exit 1
    fi

    LIFERAY_TAG=$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)

    echo "📦 Initializing ephemeral LDM project [$PROJECT_NAME] (PostgreSQL)..."
    ldm_cmd init-from . "$PROJECT_NAME" \
        --host-name "$TARGET_HOST" \
        --db postgresql \
        --no-captcha \
        --non-interactive

    echo "⚡ Starting Liferay container with tag [$LIFERAY_TAG] (Detached + Sidecar)..."
    ldm_cmd run "$PROJECT_NAME" \
        --tag "$LIFERAY_TAG" \
        --detach \
        --sidecar \
        --no-captcha \
        --non-interactive
else
    echo "⏭️  Skipping initialization/boot for existing project '$PROJECT_NAME'."
fi

# --- Phase 3: Build & Deploy ---

echo "🔨 Phase 3: Building AICA Client Extensions..."
log_command "./gradlew deploy"
./gradlew deploy

echo "🚚 Syncing artifacts to container [$PROJECT_NAME]..."
ldm_cmd deploy "$PROJECT_NAME" --non-interactive

# --- Phase 4: Wait for Ready ---

echo "⏳ Waiting for Liferay to be ready at https://$TARGET_HOST..."
MAX_RETRIES=60
RETRY_COUNT=0
READY=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "https://$TARGET_HOST" || echo "000")
    
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

cleanup() {
    if [ $EXISTING_PROJECT -eq 1 ]; then
        echo -e "\n🛑 Skipping cleanup for existing project '$PROJECT_NAME'."
    elif [ $KEEP_PROJECT -eq 1 ]; then
        echo -e "\n🛡️  Skipping cleanup: --keep flag was provided for '$PROJECT_NAME'."
    else
        echo -e "\n🧹 Cleaning up environment..."
        ldm_cmd rm "$PROJECT_NAME" --delete --non-interactive || true
        echo "✨ Done."
    fi
}

trap cleanup EXIT

# Set the environment variables for Playwright
export BASE_URL="https://$TARGET_HOST"
export LIFERAY_USER="${LIFERAY_USER:-test@liferay.com}"
export LIFERAY_PASSWORD="${LIFERAY_PASSWORD:-L1feray$}"

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
    ldm_cmd logs "$PROJECT_NAME" --tail 50 || true
    echo "💡 Debugging: Check 'test-results' for failure snapshots."
    exit 1
fi
