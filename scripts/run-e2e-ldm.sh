#!/bin/bash
# scripts/run-e2e-ldm.sh - AICA E2E Test Orchestrator using Liferay Docker Manager (LDM)

set -e

# --- Argument Parsing ---
VERBOSE=0
PROJECT_NAME=""
EXISTING_PROJECT=0
KEEP_PROJECT=0
INIT_ONLY=0
CI_MODE=0

# Auto-detect CI environment
if [ "$CI" = "true" ] || [ "$GITHUB_ACTIONS" = "true" ]; then
    CI_MODE=1
fi

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -v|--verbose) VERBOSE=1 ;;
        -p|--project) PROJECT_NAME="$2"; EXISTING_PROJECT=1; shift ;;
        -k|--keep) KEEP_PROJECT=1 ;;
        -i|--init|--init-only) INIT_ONLY=1 ;;
        --ci) CI_MODE=1 ;;
        *) echo "Usage: $0 [-v] [-k] [-i] [--ci] [-p <project_name>]"; exit 1 ;;
    esac
    shift
done

# If verbose mode is enabled, let the user know
if [ $VERBOSE -eq 1 ]; then
  echo "🛠️  Verbose mode enabled. Realized commands will be displayed with [CMD]."
fi

# Define LDM interactivity flag based on CI_MODE
# In CI, we use -y to force non-interactive mode (sudo -n)
# Locally, we omit it to allow OS-level password prompts
LDM_Y_FLAG=""
if [ $CI_MODE -eq 1 ]; then
    LDM_Y_FLAG="-y"
fi

if [ $INIT_ONLY -eq 1 ]; then
  echo "🏗️  Init-only mode enabled. Script will stop after Liferay is ready."
fi

if [ $KEEP_PROJECT -eq 1 ]; then
  echo "🛡️  Keep mode enabled. Ephemeral project will NOT be deleted after tests."
fi
# If no project specified, use default ephemeral one
if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME="aica-e2e"
    EXISTING_PROJECT=0
    # HARDENING: Proactively remove any existing project folder to prevent 
    # Yarn workspace name collisions during Phase 2 (Building).
    if [ -d "$PROJECT_NAME" ]; then
        echo "🧹 Removing stale project directory '$PROJECT_NAME' before build..."
        rm -rf "$PROJECT_NAME"
    fi
else
    echo "🏗️  Using existing LDM project: $PROJECT_NAME"
fi

# --- Constants ---
REQUIRED_LDM_VERSION="2.7.24"
DEFAULT_HOST="aica-e2e.local"

# LDM 2.7.14+ automatically forwards OPENAI_*, GEMINI_*, etc.
# We explicitly add AI_ prefix to the passthrough list for AICA-specific keys.
export LDM_FORWARD_PREFIXES="${LDM_FORWARD_PREFIXES:-AI_}"
TARGET_HOST="${LIFERAY_HOST:-$DEFAULT_HOST}"
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

# --- Phase 0: Environment Loading ---

# Load local .env if it exists (for local runs)
if [ -f ".env" ]; then
    echo "📄 Loading environment variables from .env..."
    # shellcheck disable=SC2046
    export $(grep -v '^#' .env | xargs)
fi

# --- Phase 1: Environment Verification ---

if ! command -v ldm &> /dev/null; then
    echo "❌ ERROR: 'ldm' command not found in PATH."
    echo "🔗 Install it from: https://github.com/peterrichards-lr/liferay-docker-manager"
    exit 1
fi

# Output LDM version for diagnostics
LDM_VERSION_OUTPUT=$(ldm --version)
echo "📦 LDM Version: $LDM_VERSION_OUTPUT"

CURRENT_LDM_VERSION=$(echo "$LDM_VERSION_OUTPUT" | awk '{print $2}')
if ! version_ge "$REQUIRED_LDM_VERSION" "$CURRENT_LDM_VERSION"; then
    echo "❌ ERROR: LDM version $CURRENT_LDM_VERSION is too old. Need >= $REQUIRED_LDM_VERSION."
    exit 1
fi

# Determine the target host
if [ $EXISTING_PROJECT -eq 1 ]; then
    # Try to resolve host from existing project config
    TARGET_HOST=$(ldm list | grep "^$PROJECT_NAME " | awk '{print $3}' || echo "")
    if [ -z "$TARGET_HOST" ]; then
        echo "❌ ERROR: Could not find host name for project '$PROJECT_NAME'. Is it initialized?"
        exit 1
    fi
else
    TARGET_HOST="$DEFAULT_HOST"
fi

echo "🔍 Running LDM Doctor (Silent)..."
if ! ldm_cmd doctor --skip-project > /dev/null; then
    echo "❌ ERROR: Environment check failed. Run 'ldm doctor' manually."
    exit 1
fi

echo "🏗️  Ensuring LDM Shared Infrastructure is active..."
# shellcheck disable=SC2086
ldm_cmd infra-setup $LDM_Y_FLAG

# --- Phase 2: Build & Deployment Preparation ---

# We build BEFORE initializing the project to ensure fresh LCP.json metadata is captured
echo "🔨 Phase 2: Building AICA Client Extensions..."
log_command "./gradlew deploy"
./gradlew deploy

# --- Phase 3: Project Init, Host Setup & Start ---

if [ $EXISTING_PROJECT -eq 0 ]; then
    if [ ! -f "$GRADLE_PROPS" ]; then
        echo "❌ ERROR: $GRADLE_PROPS not found."
        exit 1
    fi

    LIFERAY_TAG=$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)

    # Hostname Resolution & CI Setup (Pre-Init)
    if [ "$CI_MODE" -eq 1 ]; then
        echo "🤖 CI Mode detected. Setting up project DNS tree via LDM (Pre-Init)..."
        # In CI, we fix the main host first so import succeeds, then project tree after init
        # shellcheck disable=SC2086
        ldm_cmd fix-hosts "$TARGET_HOST" $LDM_Y_FLAG
    else
        # Local Hostname Resolution Check
        if ! host "$TARGET_HOST" &> /dev/null && ! grep -q "$TARGET_HOST" /etc/hosts; then
            echo "❌ ERROR: Hostname '$TARGET_HOST' does not resolve."
            echo "💡 ACTION REQUIRED: Run the following command to fix your hosts file, then restart this script:"
            echo "   ldm fix-hosts $TARGET_HOST"
            exit 1
        fi
    fi

    echo "📦 Initializing ephemeral LDM project [$PROJECT_NAME] (PostgreSQL)..."
    # import parameters: creates a one-time static import for testing
    # shellcheck disable=SC2086
    ldm_cmd import . "$PROJECT_NAME" \
        $LDM_Y_FLAG \
        --host-name "$TARGET_HOST" \
        --db postgresql \
        --no-seed \
        $INTERNAL_STATE_FLAG \
        --no-captcha \
        --no-run

    # Project-wide DNS Setup (CI only)
    if [ "$CI_MODE" -eq 1 ]; then
        echo "🤖 CI Mode detected. Finalizing project DNS tree via LDM..."
        # LDM 2.7.11+ automatically handles all subdomains for the project non-interactively
        # shellcheck disable=SC2086
        ldm_cmd fix-hosts "$PROJECT_NAME" $LDM_Y_FLAG
        echo "✅ Hostname setup complete."
    fi


    echo "⚡ Starting Liferay container with tag [$LIFERAY_TAG] (Detached + Sidecar)..."
    # LDM 2.7.12+ automatically:
    # 1. Detects and handles external volume locking (--internal-state)
    # 2. Forwards AI environment variables (OPENAI_*, GEMINI_*, etc.)
    # shellcheck disable=SC2086
    ldm_cmd run "$PROJECT_NAME" \
        --tag "$LIFERAY_TAG" \
        --sidecar \
        --no-captcha \
        $LDM_Y_FLAG
else
    echo "⏭️  Skipping initialization/boot for existing project '$PROJECT_NAME'."
fi

# --- Phase 4: Sync & Wait ---

# Find all client extension ZIPs in dist folders
ARTIFACTS=$(find client-extensions -name "*.zip" -path "*/dist/*")

if [ -z "$ARTIFACTS" ]; then
    echo "⚠️  WARNING: No artifacts found to deploy. Did the build fail?"
else
    echo "🚚 Syncing artifacts to container [$PROJECT_NAME] using native Atomic Move..."
    # LDM deploy uses the 'Atomic Move' pattern by default since v2.7.6
    # shellcheck disable=SC2086
    ldm_cmd deploy "$PROJECT_NAME" $ARTIFACTS
fi

echo "⏳ Waiting for Liferay to be ready at https://$TARGET_HOST..."
# LDM 2.7.12+ wait command blocks until the HTTP layer is responsive
if ! ldm_cmd wait "$PROJECT_NAME" --timeout 1800; then
    echo -e "\n❌ ERROR: Liferay failed to become ready within 30 minutes."
    ldm_cmd logs "$PROJECT_NAME" --tail 100
    exit 1
fi

echo -e "\n✅ Liferay is UP and responding!"

# --- Phase 5: Test Execution & Teardown ---

# --- Phase 5: Test Execution & Teardown ---

if [ $INIT_ONLY -eq 1 ]; then
    echo -e "\n✅ Environment prepopulated and ready at https://$TARGET_HOST"
    echo "⏭️  Stopping early due to --init flag."
    exit 0
fi

echo "🎭 Phase 5: Running Playwright E2E tests..."

cleanup() {
    if [ $EXISTING_PROJECT -eq 1 ]; then
        echo -e "\n🛑 Skipping cleanup for existing project '$PROJECT_NAME'."
    elif [ $KEEP_PROJECT -eq 1 ]; then
        echo -e "\n🛡️  Skipping cleanup: --keep flag was provided for '$PROJECT_NAME'."
    else
        echo -e "\n🧹 Cleaning up environment..."
        # shellcheck disable=SC2086
        ldm_cmd rm "$PROJECT_NAME" --delete $LDM_Y_FLAG || true
        echo "✨ Done."
    fi
}

trap cleanup EXIT

# Set the environment variables for Playwright and the Microservice
export BASE_URL="https://$TARGET_HOST"
export LIFERAY_API_URL="$BASE_URL"
export LIFERAY_URL="$BASE_URL"

# Map CI secrets to standard AICA variables if provided
export LIFERAY_USER="${LIFERAY_USER:-${LIFERAY_ADMIN_EMAIL:-test@liferay.com}}"
export LIFERAY_PASSWORD="${LIFERAY_PASSWORD:-${LIFERAY_ADMIN_PASSWORD:-test}}"

# Ensure microservice has access to these if they were passed via CI secrets
export LIFERAY_API_USERNAME="$LIFERAY_USER"
export LIFERAY_API_PASSWORD="$LIFERAY_PASSWORD"

# HARDENING: Force Basic Auth fallback in E2E mode.
# We unset OAuth credentials and set the auth method to 'basic'.
export LIFERAY_OAUTH_CLIENT_ID=""
export LIFERAY_OAUTH_CLIENT_SECRET=""
export LIFERAY_AUTH_METHOD="basic"

# Determine package manager command
RUN_VERIFY=""
if command -v yarn &> /dev/null; then
    RUN_VERIFY="yarn verify"
elif command -v npm &> /dev/null; then
    RUN_VERIFY="npm run verify"
fi

if [ -z "$RUN_VERIFY" ]; then
    echo "❌ ERROR: Neither 'yarn' nor 'npm' found in PATH."
    exit 1
fi

# Execute the tests using the root verification script
log_command "$RUN_VERIFY"
if $RUN_VERIFY; then
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
