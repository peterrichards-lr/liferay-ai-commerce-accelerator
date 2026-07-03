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

NO_SSL=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -v|--verbose) VERBOSE=1 ;;
        -p|--project) PROJECT_NAME="$2"; EXISTING_PROJECT=1; shift ;;
        -k|--keep) KEEP_PROJECT=1 ;;
        -i|--init|--init-only) INIT_ONLY=1 ;;
        --ci) CI_MODE=1 ;;
        --no-ssl) NO_SSL=1 ;;
        *) echo "Usage: $0 [-v] [-k] [-i] [--ci] [--no-ssl] [-p <project_name>]"; exit 1 ;;
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

# --- Pre-flight Checks (Sentinel) ---
if [ $CI_MODE -eq 0 ]; then
  node scripts/preflight.mjs
fi

# If no project specified, use default ephemeral one
if [ -z "$PROJECT_NAME" ]; then
    if [ $CI_MODE -eq 1 ]; then
        PROJECT_NAME="aica-e2e"
    else
        # Make project name unique per-user/environment to prevent conflicts locally
        UNIQUE_ID="${USER:-$(id -un 2>/dev/null || echo 'local')}"
        PROJECT_NAME="aica-e2e-$UNIQUE_ID"
    fi
    EXISTING_PROJECT=0
    if ldm list | grep "$PROJECT_NAME" | grep -q "Running"; then
        echo "ℹ  Auto-detected that project '$PROJECT_NAME' is already running in LDM. Switching to update/deploy mode."
        EXISTING_PROJECT=1
    fi

    # HARDENING: Proactively remove any existing project folder to prevent
    # Yarn workspace name collisions during Phase 2 (Building).
    if [ $EXISTING_PROJECT -eq 0 ] && [ -d "$PROJECT_NAME" ]; then
        echo "🧹 Removing stale project directory '$PROJECT_NAME' before build..."
        rm -rf "$PROJECT_NAME"
    fi
else
    echo "🏗️  Using existing LDM project: $PROJECT_NAME"
fi

# --- Constants ---
REQUIRED_LDM_VERSION="2.8.0"
DEFAULT_HOST="${PROJECT_NAME}.local"

# LDM 2.7.14+ automatically forwards OPENAI_*, GEMINI_*, etc.
# We explicitly add AI_ prefix to the passthrough list for AICA-specific keys.
export LDM_FORWARD_PREFIXES="AI_,LIFERAY_"
TARGET_HOST="${LIFERAY_HOST:-$DEFAULT_HOST}"
GRADLE_PROPS="gradle.properties"

# Redefine ldm command to run with python3.13 if present (prevents python3.14 conflicts on macOS host)
ldm() {
    if [ -x "/opt/homebrew/bin/python3.13" ]; then
        /opt/homebrew/bin/python3.13 /usr/local/bin/ldm "$@"
    else
        command ldm "$@"
    fi
}

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

# Write a tiny progress state file on disk for fast AI monitoring and feedback loops
write_signal() {
    echo "$1" > .progress-signal
    echo "📣 [SIGNAL] State changed to: $1"
}

version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" == "$1" ]
}

echo "🚀 Starting AICA E2E Orchestration..."

# Truncate raw logs to prevent Forensic Log Analyzer false-positives from legacy runs
mkdir -p logs
rm -f logs/e2e-microservice.log
touch logs/e2e-microservice.log

# --- Phase 0: Environment Loading ---

# Force JDK 21 on macOS to ensure Liferay Docker Manager (LDM) compatibility
GRADLE_JAVA_21=""
if [ "$(uname)" == "Darwin" ]; then
    if [ -d "/opt/homebrew/opt/openjdk@21" ]; then
        GRADLE_JAVA_21="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    elif command -v /usr/libexec/java_home &> /dev/null; then
        if /usr/libexec/java_home -v 21 &> /dev/null; then
            GRADLE_JAVA_21=$(/usr/libexec/java_home -v 21)
        fi
    fi
fi

if [ -n "$GRADLE_JAVA_21" ]; then
    major_ver=$("$GRADLE_JAVA_21/bin/java" -version 2>&1 | head -n 1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [ "$major_ver" -lt 25 ] 2>/dev/null; then
        export JAVA_HOME="$GRADLE_JAVA_21"
        echo "☕ Force-configured global JAVA_HOME to JDK 21: $JAVA_HOME"
    fi
fi

# Load E2E or local .env if it exists (for local runs)
if [ -f ".env.e2e" ]; then
    echo "📄 Loading environment variables from .env.e2e..."
    # shellcheck disable=SC2046
    export $(grep -v '^#' .env.e2e | xargs)
elif [ -f ".env" ]; then
    echo "📄 Loading environment variables from .env..."
    # shellcheck disable=SC2046
    export $(grep -v '^#' .env | xargs)
fi

# Dynamically override the URLs to match the unique TARGET_HOST
if [ $NO_SSL -eq 1 ]; then
    export LIFERAY_URL="http://$TARGET_HOST"
    export LIFERAY_API_URL="http://$TARGET_HOST"
    export COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL="http"
else
    export LIFERAY_URL="https://$TARGET_HOST"
    export LIFERAY_API_URL="https://$TARGET_HOST"
    export COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL="https"
fi
export COM_LIFERAY_LXC_DXP_MAIN_DOMAIN="$TARGET_HOST"

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

# Determine the target host and URL
if [ $EXISTING_PROJECT -eq 1 ]; then
    # Try to resolve URL from existing project config
    TARGET_URL=$(ldm list | grep "$PROJECT_NAME" | grep -oE 'https?://[a-zA-Z0-9./:-]+' | xargs || echo "")
    if [ -z "$TARGET_URL" ]; then
        echo "❌ ERROR: Could not find URL for project '$PROJECT_NAME'. Is it initialized?"
        exit 1
    fi
    TARGET_HOST=$(echo "$TARGET_URL" | sed -E 's/https?:\/\///' | cut -d':' -f1)
else
    TARGET_HOST="$DEFAULT_HOST"
    if [ $NO_SSL -eq 1 ]; then
        TARGET_URL="http://$TARGET_HOST"
    else
        TARGET_URL="https://$TARGET_HOST"
    fi
fi

LDM_SSL_FLAG=""
if [ $NO_SSL -eq 1 ]; then
    LDM_SSL_FLAG="--no-ssl"
fi

echo "🔍 Running LDM Doctor (Silent)..."
if ! ldm_cmd doctor --skip-project > /dev/null; then
    echo "⚠️  WARNING: LDM Doctor reported environment warnings. Continuing..."
fi

echo "🏗️  Ensuring LDM Shared Infrastructure is active..."
# shellcheck disable=SC2086
ldm_cmd infra-setup $LDM_Y_FLAG

echo "⏳ Giving Shared Infrastructure (Traefik/PostgreSQL) 15s to become healthy..."
sleep 15

# --- Phase 2: Build & Deployment Preparation ---

# We build BEFORE initializing the project to ensure fresh LCP.json metadata is captured
write_signal "BUILDING"
echo "🔨 Phase 2: Building AICA Client Extensions..."
TEMP_MOVE=0
if [ $EXISTING_PROJECT -eq 1 ] && [ -d "$PROJECT_NAME" ]; then
    echo "📦 Temporarily moving project directory '$PROJECT_NAME' to prevent Yarn workspace duplicates..."
    mv "$PROJECT_NAME" "../$PROJECT_NAME.tmp"
    TEMP_MOVE=1
fi

log_command "./gradlew deploy"
GRADLE_JAVA_HOME=""
if [ "$(uname)" == "Darwin" ]; then
    is_valid_jdk() {
        local path=$1
        [ -n "$path" ] && [ -x "$path/bin/java" ] || return 1
        "$path/bin/java" -version &>/dev/null || return 1
        local major_ver
        major_ver=$("$path/bin/java" -version 2>&1 | head -n 1 | cut -d'"' -f2 | cut -d'.' -f1)
        [ "$major_ver" -lt 25 ] 2>/dev/null || return 1
        return 0
    }

    if [ -d "/opt/homebrew/opt/openjdk@21" ] && is_valid_jdk "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"; then
        GRADLE_JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
        echo "☕ Using Homebrew openjdk@21: $GRADLE_JAVA_HOME"
    elif [ -d "/opt/homebrew/opt/openjdk@17" ] && is_valid_jdk "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"; then
        GRADLE_JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
        echo "☕ Using Homebrew openjdk@17: $GRADLE_JAVA_HOME"
    elif command -v /usr/libexec/java_home &> /dev/null; then
        for ver in 21 17 11; do
            candidate=$(/usr/libexec/java_home -v $ver 2>/dev/null || true)
            if is_valid_jdk "$candidate"; then
                GRADLE_JAVA_HOME="$candidate"
                echo "☕ Using JDK $ver for Gradle build: $GRADLE_JAVA_HOME"
                break
            fi
        done
    fi
fi

if [ -n "$GRADLE_JAVA_HOME" ]; then
    if ! JAVA_HOME="$GRADLE_JAVA_HOME" ./gradlew deploy; then
        if [ $TEMP_MOVE -eq 1 ]; then
            mv "../$PROJECT_NAME.tmp" "$PROJECT_NAME"
        fi
        exit 1
    fi
else
    if ! ./gradlew deploy; then
        if [ $TEMP_MOVE -eq 1 ]; then
            mv "../$PROJECT_NAME.tmp" "$PROJECT_NAME"
        fi
        exit 1
    fi
fi

if [ $TEMP_MOVE -eq 1 ]; then
    echo "📦 Restoring project directory '$PROJECT_NAME'..."
    mv "../$PROJECT_NAME.tmp" "$PROJECT_NAME"
fi

# HARDENING: Ensure all generated zip files are visible to LDM in the expected locations
for cx in client-extensions/*; do
    if [ -d "$cx/dist" ]; then
        cp "$cx/dist/"*.zip "$cx/" 2>/dev/null || true
    fi
done

# --- Phase 3: Project Init, Host Setup & Start ---

if [ $EXISTING_PROJECT -eq 0 ]; then
    if [ ! -f "$GRADLE_PROPS" ]; then
        echo "❌ ERROR: $GRADLE_PROPS not found."
        exit 1
    fi

    LIFERAY_TAG=$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)

    # Local Hostname Resolution Check
    REQUIRED_HOSTS=(
        "$TARGET_HOST"
        "aicommerceacceleratorconfiguration.$TARGET_HOST"
        "aicommerceacceleratorfrontend.$TARGET_HOST"
        "ai-commerce-accelerator-microservice.$TARGET_HOST"
    )

    MISSING_HOSTS=()
    for HOST in "${REQUIRED_HOSTS[@]}"; do
        if ! ping -c 1 "$HOST" &> /dev/null && ! grep -q "$HOST" /etc/hosts; then
            MISSING_HOSTS+=("$HOST")
        fi
    done

    if [ ${#MISSING_HOSTS[@]} -gt 0 ]; then
        echo "❌ ERROR: The following required hostnames do not resolve:"
        for HOST in "${MISSING_HOSTS[@]}"; do
            echo "   - $HOST"
        done
        echo ""
        echo "💡 ACTION REQUIRED: Run the following command to fix your hosts file, then restart this script:"
        echo "   ldm system doctor --fix-hosts ${MISSING_HOSTS[*]}"
        exit 1
    fi

    write_signal "IMPORTING"
    echo "📦 Initializing ephemeral LDM project [$PROJECT_NAME] (PostgreSQL)..."
    # import parameters: creates a one-time static import for testing
    # shellcheck disable=SC2086
    ldm_cmd import . "$PROJECT_NAME" \
        -y \
        --host-name "$TARGET_HOST" \
        --db postgresql \
        $INTERNAL_STATE_FLAG \
        --no-captcha \
        --no-run \
        $LDM_SSL_FLAG

    # Sync OSGi modules built by Gradle into the LDM staging directory
    if [ -d "bundles/osgi/modules" ]; then
        echo "🔄 Syncing built OSGi modules to LDM modules directory..."
        mkdir -p "$PROJECT_NAME/osgi/modules"
        cp bundles/osgi/modules/*.jar "$PROJECT_NAME/osgi/modules/" 2>/dev/null || true
        # Remove the legacy JAX-RS 2.x reindex endpoint bundle to prevent conflicts
        rm -f "$PROJECT_NAME/osgi/modules/com.liferay.accelerator.reindex.endpoint-1.0.0.jar"
    fi

    # Sync client extensions built by Gradle/yarn into the LDM staging directory
    echo "🔄 Syncing built client extensions to LDM staging directory..."
    mkdir -p "$PROJECT_NAME/osgi/client-extensions"
    if [ -d "bundles/osgi/client-extensions" ]; then
        cp bundles/osgi/client-extensions/*.zip "$PROJECT_NAME/osgi/client-extensions/" 2>/dev/null || true
    fi
    # Fallback to source dist/build folders if standalone build was used
    find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) -exec cp {} "$PROJECT_NAME/osgi/client-extensions/" \; 2>/dev/null || true
    chmod -R 777 "$PROJECT_NAME" 2>/dev/null || true

    write_signal "STARTING"
    echo "⚡ Starting Liferay container with tag [$LIFERAY_TAG] (Detached + Sidecar)..."
    # LDM 2.7.12+ automatically:
    # 1. Detects and handles external volume locking (--internal-state)
    # 2. Forwards AI environment variables (OPENAI_*, GEMINI_*, etc.)
    # LDM 2.8.0+ supports --lean for constrained environments.
    # shellcheck disable=SC2086
    ldm_cmd run "$PROJECT_NAME" \
        --host-name "$TARGET_HOST" \
        --tag "$LIFERAY_TAG" \
        --sidecar \
        --no-captcha \
        --no-wait \
        --jvm-args="-Xmx2560m -XX:ReservedCodeCacheSize=512m" \
        --fast-login \
        --feature LPD-35443 \
        -y \
        $LDM_SSL_FLAG

else
    echo "⏭️  Skipping initialization/boot for existing project '$PROJECT_NAME'."

    # Sync OSGi modules to the LDM staging directory for hot-deploy
    if [ -d "bundles/osgi/modules" ]; then
        echo "🔄 Syncing built OSGi modules to LDM modules directory for hot-deploy..."
        mkdir -p "$PROJECT_NAME/osgi/modules"
        cp bundles/osgi/modules/*.jar "$PROJECT_NAME/osgi/modules/" 2>/dev/null || true
    fi

    # Sync client extensions to the LDM staging directory for hot-deploy
    echo "🔄 Syncing built client extensions to LDM staging directory for hot-deploy..."
    mkdir -p "$PROJECT_NAME/osgi/client-extensions"
    find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) -exec cp {} "$PROJECT_NAME/osgi/client-extensions/" \; 2>/dev/null || true
    chmod -R 777 "$PROJECT_NAME" 2>/dev/null || true
fi

# --- Phase 4: Sync & Wait ---

# Find all client extension ZIPs in dist or build/libs folders
ARTIFACTS=$(find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) 2>/dev/null)

if [ -z "$ARTIFACTS" ]; then
    echo "⚠️  WARNING: No artifacts found to deploy. Did the build fail?"
else
    echo "🚚 Syncing artifacts to container [$PROJECT_NAME] using native Atomic Move..."
    # LDM deploy uses the 'Atomic Move' pattern by default since v2.7.6
    # shellcheck disable=SC2086
    ldm_cmd deploy "$PROJECT_NAME" $ARTIFACTS
    
    # Fix client extension permissions inside the container on Linux host/CI runners
    if [ "$CI_MODE" -eq 1 ] || [ "$(uname)" == "Linux" ]; then
        echo "🔧 Fixing client extension file permissions inside the container..."
        # Set 777 permissions on the host directories to bypass UID mapping limitations
        chmod -R 777 "$PROJECT_NAME" 2>/dev/null || true
        docker exec -u 0 "$PROJECT_NAME" chown -R liferay:liferay /opt/liferay/osgi/client-extensions /opt/liferay/deploy || true
        docker exec -u 0 "$PROJECT_NAME" chmod -R 777 /opt/liferay/osgi/client-extensions /opt/liferay/deploy || true
        # Force Liferay's OSGi file install/deployer to re-process files after permissions update.
        # We use 'touch -c' (no-create) to avoid creating empty literal files if they do not exist.
        for art in $ARTIFACTS; do
            basename_art=$(basename "$art")
            docker exec -u 0 "$PROJECT_NAME" touch -c "/opt/liferay/osgi/client-extensions/$basename_art" 2>/dev/null || true
            docker exec -u 0 "$PROJECT_NAME" touch -c "/opt/liferay/deploy/$basename_art" 2>/dev/null || true
        done
    fi
    
    # If the project was already running, give OSGi hot-deployer 25s to refresh import maps
    if [ $EXISTING_PROJECT -eq 1 ]; then
        write_signal "WAITING_HEALTHY"
        echo "⏳ Hot-deploying changes... Waiting 25s for OSGi container to refresh import maps..."
        sleep 25
    fi
fi

write_signal "WAITING_HEALTHY"
echo "⏳ Waiting for Liferay to be ready at $TARGET_URL..."
# LDM wait command blocks until the HTTP layer is responsive and streams boot milestones
if ! ldm_cmd wait "$PROJECT_NAME" -d --stream-status --timeout 1800; then
    echo -e "\n❌ ERROR: Liferay failed to become ready within 30 minutes."
    ldm_cmd logs "$PROJECT_NAME" --tail 100
    exit 1
fi

echo -e "\n✅ Liferay is UP and responding!"

# Give Liferay's embedded Elasticsearch 45s of idle CPU time to finish startup indexing on cold boots
if [ $EXISTING_PROJECT -eq 0 ]; then
    write_signal "WAITING_HEALTHY"
    echo "⏳ Pre-warming Liferay search indexers (45 seconds)..."
    sleep 45
fi

# --- Phase 5: Test Execution & Teardown ---

# --- Phase 5: Test Execution & Teardown ---

if [ $INIT_ONLY -eq 1 ]; then
    echo -e "\n✅ Environment prepopulated and ready at $TARGET_URL"
    echo "⏭️  Stopping early due to --init flag."
    exit 0
fi

echo "🎭 Phase 5: Running Playwright E2E tests..."

cleanup() {
    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        write_signal "SUCCESS"
    else
        write_signal "FAILED"
    fi

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
export BASE_URL="$TARGET_URL"
export LIFERAY_API_URL="$BASE_URL"
export LIFERAY_URL="$BASE_URL"
export LIFERAY_BATCH_CALLBACK_URL="http://host.docker.internal:3001/api/v1/batch/callback"


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
write_signal "TESTING"
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
