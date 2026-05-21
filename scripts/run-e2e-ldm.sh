#!/bin/bash
# scripts/run-e2e-ldm.sh - AICA E2E Test Orchestrator using Liferay Docker Manager (LDM)

set -e

# --- Argument Parsing ---
VERBOSE=0
PROJECT_NAME=""
EXISTING_PROJECT=0
KEEP_PROJECT=0
INIT_ONLY=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -v|--verbose) VERBOSE=1 ;;
        -p|--project) PROJECT_NAME="$2"; EXISTING_PROJECT=1; shift ;;
        -k|--keep) KEEP_PROJECT=1 ;;
        -i|--init|--init-only) INIT_ONLY=1 ;;
        *) echo "Usage: $0 [-v] [-k] [-i] [-p <project_name>]"; exit 1 ;;
    esac
    shift
done

# If verbose mode is enabled, let the user know
if [ $VERBOSE -eq 1 ]; then
  echo "🛠️  Verbose mode enabled. Realized commands will be displayed with [CMD]."
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
else
    echo "🏗️  Using existing LDM project: $PROJECT_NAME"
fi

# --- Constants ---
REQUIRED_LDM_VERSION="2.5.4"
DEFAULT_HOST="aica-e2e.local"
if [ "$CI" = "true" ] || [ "$GITHUB_ACTIONS" = "true" ]; then
    # Use localhost in CI to avoid needing sudo for /etc/hosts modifications
    DEFAULT_HOST="localhost"
fi
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

# --- Phase 2: Build & Deployment Preparation ---

# We build BEFORE initializing the project to ensure fresh LCP.json metadata is captured
echo "🔨 Phase 2: Building AICA Client Extensions..."
log_command "./gradlew deploy"
./gradlew deploy

# --- Phase 3: Project Init & Start ---

if [ $EXISTING_PROJECT -eq 0 ]; then
    if [ ! -f "$GRADLE_PROPS" ]; then
        echo "❌ ERROR: $GRADLE_PROPS not found."
        exit 1
    fi

    LIFERAY_TAG=$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)

    # FIX: SanDisk/External Drive Workaround
    # Bind mounts for osgi/state fail on external drives due to locking issues.
    # We use LDM's --internal-state flag which uses an internal volume instead.
    INTERNAL_STATE_FLAG=""
    if [[ "$PWD" == "/Volumes/"* ]]; then
        echo "💾 External drive detected. Optimizing Docker filesystem mounts using --internal-state..."
        INTERNAL_STATE_FLAG="--internal-state"
    fi

    echo "📦 Initializing ephemeral LDM project [$PROJECT_NAME] (PostgreSQL)..."
    # import parameters: creates a one-time static import for testing
    # shellcheck disable=SC2086
    ldm_cmd import . "$PROJECT_NAME" \
        -y \
        --host-name "$TARGET_HOST" \
        --db postgresql \
        $INTERNAL_STATE_FLAG \
        --no-captcha \
        --no-run

    echo "⚡ Starting Liferay container with tag [$LIFERAY_TAG] (Detached + Sidecar)..."
    # shellcheck disable=SC2086
    ldm_cmd run "$PROJECT_NAME" \
        --tag "$LIFERAY_TAG" \
        $INTERNAL_STATE_FLAG \
        --sidecar \
        --no-captcha \
        --env OPENAI_API_KEY="$OPENAI_API_KEY" \
        --env GEMINI_API_KEY="$GEMINI_API_KEY" \
        --env ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
        --env AI_API_KEY="$AI_API_KEY" \
        --env AI_MEDIA_API_KEY="$AI_MEDIA_API_KEY" \
        -y
else
    echo "⏭️  Skipping initialization/boot for existing project '$PROJECT_NAME'."
fi

# --- Phase 4: Sync & Wait ---

# Ensure artifacts are synced to the container
# HARDENING: We use the "Staging & Atomic Move" pattern instead of raw 'ldm deploy'.
# This approach is critical to prevent Liferay's AutoDeployScanner from picking up files 
# while they are still being written or have incorrect permissions (root-owned).
#
# STRATEGY:
# 1. Copy ZIP to a neutral staging directory (/tmp).
# 2. Re-assign ownership to the 'liferay' user while still in staging.
# 3. Use an atomic 'mv' to place the file in /opt/liferay/deploy.
#
# This ensures that the instant the scanner sees the file, it has the correct 
# permissions and is complete, avoiding 'Unable to write' errors.
echo "🚚 Syncing artifacts to container [$PROJECT_NAME] using Atomic Move pattern..."
STAGING_DIR="/tmp/aica-staging"
docker exec "$PROJECT_NAME" mkdir -p "$STAGING_DIR"

# Find all client extension ZIPs in dist folders
ARTIFACTS=$(find client-extensions -name "*.zip" -path "*/dist/*")

if [ -z "$ARTIFACTS" ]; then
    echo "⚠️  WARNING: No artifacts found to deploy. Did the build fail?"
fi

for ARTIFACT in $ARTIFACTS; do
    FILENAME=$(basename "$ARTIFACT")
    echo "  -> Staging $FILENAME..."
    docker cp "$ARTIFACT" "$PROJECT_NAME":"$STAGING_DIR/"
    echo "  -> Preparing $FILENAME (Ownership)..."
    # Ensure correct ownership and permissions in staging so it's ready before hitting the auto-deploy scanner
    docker exec -u 0 "$PROJECT_NAME" bash -c "chown liferay:liferay '$STAGING_DIR/$FILENAME' && chmod 666 '$STAGING_DIR/$FILENAME'"
    echo "  -> Deploying $FILENAME (Atomic Move)..."
    # Move into the deployment folder - since it's already owned by liferay and writable, the scanner can process it safely
    docker exec -u 0 "$PROJECT_NAME" mv "$STAGING_DIR/$FILENAME" /opt/liferay/deploy/
done

echo "⏳ Waiting for Liferay to be ready at https://$TARGET_HOST (and alternatives)..."
MAX_RETRIES=180 # Increased to 30 minutes for slow CI boots
RETRY_COUNT=0
READY=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Try HTTPS (standard LDM with sidecar)
    STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "https://$TARGET_HOST" || echo "000")
    
    # Fallback to HTTP on 8080 if HTTPS fails (direct Liferay access)
    if [ "$STATUS" == "000" ] || [ "$STATUS" == "404" ]; then
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080" || echo "$STATUS")
    fi

    if [ "$STATUS" == "200" ] || [ "$STATUS" == "302" ]; then
        echo -e "\n✅ Liferay is UP and responding (Status: $STATUS)!"
        READY=1
        break
    fi
    
    # Periodic Log Check for fatal errors
    if [ $((RETRY_COUNT % 6)) -eq 0 ]; then
        if docker logs "$PROJECT_NAME" 2>&1 | grep -q "Unable to create lock manager"; then
            echo -e "\n❌ FATAL: Filesystem locking error detected. Please check your drive format."
            exit 1
        fi
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
        ldm_cmd rm "$PROJECT_NAME" --delete -y || true
        echo "✨ Done."
    fi
}

trap cleanup EXIT

# Set the environment variables for Playwright and the Microservice
export BASE_URL="https://$TARGET_HOST"
export LIFERAY_API_URL="$BASE_URL"

# Map CI secrets to standard AICA variables if provided
export LIFERAY_USER="${LIFERAY_USER:-${LIFERAY_ADMIN_EMAIL:-test@liferay.com}}"
export LIFERAY_PASSWORD="${LIFERAY_PASSWORD:-${LIFERAY_ADMIN_PASSWORD:-L1feray$}}"

# Ensure microservice has access to these if they were passed via CI secrets
export LIFERAY_API_USERNAME="$LIFERAY_USER"
export LIFERAY_API_PASSWORD="$LIFERAY_PASSWORD"

# Execute the tests using the root verification script
log_command "yarn verify"
if yarn verify; then
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
