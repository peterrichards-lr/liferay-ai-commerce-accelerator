#!/bin/bash
# scripts/run-e2e-ldm.sh - AICA E2E Test Orchestrator using Liferay Docker Manager (LDM)

set -e

# Exit early if executed inside the Docker container (as Liferay entrypoint runs all scripts in /mnt/liferay/scripts)
if [ -f /.dockerenv ] || [ -n "$LIFERAY_HOME" ]; then
    echo "ℹ  Exiting early: run-e2e-ldm.sh is a host-side orchestrator, not meant to be run inside the Liferay container."
    if [ "${BASH_SOURCE[0]}" != "$0" ]; then
        return 0 2>/dev/null || exit 0
    else
        exit 0
    fi
fi

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
SSL_PORT=""
ALLOW_CONCURRENT=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -v|--verbose) VERBOSE=1 ;;
        -p|--project) PROJECT_NAME="$2"; EXISTING_PROJECT=1; shift ;;
        -k|--keep) KEEP_PROJECT=1 ;;
        -i|--init|--init-only) INIT_ONLY=1 ;;
        --ci) CI_MODE=1 ;;
        --no-ssl) NO_SSL=1 ;;
        --ssl-port) SSL_PORT="$2"; shift ;;
        --allow-concurrent) ALLOW_CONCURRENT=1 ;;
        --shard) export PLAYWRIGHT_SHARD="$2"; shift ;;
        --node) export LDM_NODE_TARGET="$2"; shift ;;
        *) echo "Usage: $0 [-v] [-k] [-i] [--ci] [--no-ssl] [--ssl-port <port>] [--allow-concurrent] [--shard <index/total>] [--node <target>] [-p <project_name>]"; exit 1 ;;
    esac
    shift
done

# Redefine ldm command to run with python3.13 if present (prevents python3.14 conflicts on macOS host)
ldm() {
    if [ -x "/opt/homebrew/bin/python3.13" ]; then
        /opt/homebrew/bin/python3.13 /usr/local/bin/ldm "$@"
    else
        command ldm "$@"
    fi
}

# If verbose mode is enabled, let the user know
if [ $VERBOSE -eq 1 ]; then
  echo "🛠️  Verbose mode enabled. Realized commands will be displayed with [CMD]."
fi

# Wake remote target node if targeting AWS compute (aws-1, aws-2). CI wakes the
# same node in its own step first, but this is the only wake on a local run
# against a remote node, so it stays - and it is fatal. As `|| true` it hid a
# credentials failure for weeks: the suite then spent two hours testing a host
# that may as well have been switched off, and reported anything but that (#718).
#
# 3h, not 2h: the nightly has been finishing in 1h48m-1h58m against a 2h TTL,
# so shard 2 on 2026-09-09 had five minutes to spare and the 2026-09-03/04 runs
# had two. Every one of those runs also stopped at the auth setup and ran none
# of the 30 specs. Once they do run the window closes, and a node powering off
# mid-suite reports as a connectivity failure that names nothing.
if [ -n "$LDM_NODE_TARGET" ] && [ "$LDM_NODE_TARGET" != "local" ] && [ -f "./scripts/node_power.sh" ]; then
    echo "⚡ Waking remote target node '$LDM_NODE_TARGET' for 3-hour E2E execution window..."
    if ! ./scripts/node_power.sh wake "$LDM_NODE_TARGET" 3h; then
        echo "❌ ERROR: Could not power on target node '$LDM_NODE_TARGET'."
        echo "   Refusing to run the suite against a host that may be powered off."
        exit 1
    fi
fi

# The shared LDM proxy (Traefik) normally binds SSL on :443. --ssl-port remaps
# it via LDM_SSL_PORT for hosts where 443 is already held by something unrelated
# to LDM (e.g. a local SSH tunnel) - see AICA issue #445 investigation.
SSL_PORT_SUFFIX=""
if [ -n "$SSL_PORT" ]; then
    echo "🔌 Custom SSL port requested: $SSL_PORT (shared LDM proxy will be remapped)"
    SSL_PORT_SUFFIX=":$SSL_PORT"
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
    if [ "$GITHUB_ACTIONS" = "true" ]; then
        PROJECT_NAME="aica-e2e"
    else
        # Make project name unique per-user/environment to prevent conflicts locally
        UNIQUE_ID="${USER:-$(id -un 2>/dev/null || echo 'local')}"
        PROJECT_NAME="aica-e2e-$UNIQUE_ID"
    fi


else
    echo "🏗️  Using existing LDM project: $PROJECT_NAME"
fi

# --- Helper Functions ---
version_ge() {
    # Returns 0 (true) if $2 (current) is greater than or equal to $1 (required)
    [ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

# Every LDM call names the compute target, or it silently means "local".
#
# `--node` only ever reached node_power.sh, the licence lookup and the sleep in
# the EXIT trap. No `ldm` invocation carried it, and nothing ran
# `ldm target use`, so on a CI runner - where ~/.ldmrc starts empty and there is
# no persisted default - every `ldm import`, `run`, `deploy`, `wait` and `logs`
# resolved to local.
#
# That is why the activation key kept failing. #805 registered the node with the
# MAC its licence is bound to, which was necessary and not sufficient: the
# container was never started on that node, so it took a bridge MAC and DXP
# refused the key with "MAC address matching failed, allowed MAC addresses:
# [<the node's>]" - then logged "License registered" at INFO on the next line
# and served the Activation page anyway.
#
# --- Logging Helpers ---
# stderr, not stdout: two callers capture ldm_cmd's output - `$(ldm_cmd info
# --json)` and `ldm_cmd list --json | node` - and a [CMD] line inside either
# makes the JSON unparseable. Both then fall back silently, to a default login
# and to "nothing else is running" respectively.
log_command() {
   if [ "$VERBOSE" -eq 1 ]; then
      echo -e "\033[0;34m[CMD]\033[0m $*" >&2
   fi
}

# Injected here rather than at each call site because LDM's own design notes
# record that as the recurring defect: a target threaded through call sites
# individually, where each one has to remember. All the subcommands this script
# uses accept `--node` (verified against `ldm <cmd> --help`), so there is no
# per-command exception to carry. See #1077.
ldm_cmd() {
    local node_args=()

    if [ -n "${LDM_NODE_TARGET:-}" ] && [ "$LDM_NODE_TARGET" != "local" ]; then
        node_args=(--node "$LDM_NODE_TARGET")
    fi

    log_command "ldm $* ${node_args[*]}"
    ldm "$@" "${node_args[@]}"
}

# Routed through ldm_cmd, not bare `ldm`. The concurrency check below asks
# what else is running; asking this host answers about the wrong machine, and
# on a remote target the answer is always "nothing" because nothing runs here.
# The check then passes by construction - no cover at all, from a guard that
# reads as though it provides some.
other_running_ldm_projects() {
    ldm_cmd list --json 2>/dev/null | node -e '
      try {
        const input = JSON.parse(require("fs").readFileSync(0, "utf-8"));
        const currentProject = process.env.PROJECT_NAME || "";
        const running = input
          .filter(p => p.status === "Running" && p.project !== currentProject)
          .map(p => p.project);
        if (running.length > 0) {
          console.log(running.join("\n"));
        }
      } catch (e) {}
    ' || true
}

write_signal() {
    local status="$1"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat <<EOF > .e2e-status.json
{
  "status": "$status",
  "timestamp": "$timestamp",
  "project": "${PROJECT_NAME:-aica-e2e}"
}
EOF
}

# --- Constants ---
REQUIRED_LDM_VERSION="2.15.14"
# .demo rather than .local: .local is a reserved mDNS/Bonjour TLD on macOS,
# where getaddrinfo() can be slow regardless of a matching /etc/hosts entry
# (see liferay-docker-manager#967/#969).
DEFAULT_HOST="${PROJECT_NAME}.demo"

# LDM 2.7.14+ automatically forwards OPENAI_*, GEMINI_*, etc.
# We explicitly add AI_ prefix to the passthrough list for AICA-specific keys.
#
# COM_LIFERAY_LXC_ is deliberately absent: LDM forwards it by default, along
# with LXC_ and the AI providers, and LDM_FORWARD_PREFIXES extends that list
# rather than replacing it. Adding it here would read as a fix for the
# microservice's missing Liferay URL and change nothing.
export LDM_FORWARD_PREFIXES="AI_,LIFERAY_"
TARGET_HOST="${LIFERAY_HOST:-$DEFAULT_HOST}"
GRADLE_PROPS="gradle.properties"

# The wake step resolves the node's current address and records it in both of
# these. Read it rather than re-resolving, so the tunnel can never point
# somewhere other than the node LDM is driving.
node_ssh_endpoint() {
    python3 - "$LDM_NODE_TARGET" <<'PY'
import json, sys
from pathlib import Path

node = sys.argv[1]
for path, key in ((Path.home() / ".ldmrc", "targets"),
                  (Path(".node-power-config.json"), "nodes")):
    try:
        entry = json.loads(path.read_text()).get(key, {}).get(node, {})
    except Exception:
        continue
    if entry.get("host"):
        print(f"{entry.get('user') or 'ldm-automation'}@{entry['host']}")
        break
PY
}

# Every raw `docker` call in this script addresses a container by name. LDM's
# own invocations follow the target because ldm_cmd appends --node; these did
# not, so on a remote target they addressed this host's daemon, where the
# containers do not exist. Each is written to tolerate failure, so all nine
# failed silently (#1089).
#
# Setting DOCKER_HOST once routes them all rather than annotating nine call
# sites, and it is the same transport LDM uses (docker system dial-stdio over
# SSH). The proxy removals at the infra-setup and run steps are included
# deliberately: on a remote target the proxy runs on the node, so the node is
# what a stale proxy has to be cleared from.
route_docker_to_node() {
    [ -n "${LDM_NODE_TARGET:-}" ] && [ "$LDM_NODE_TARGET" != "local" ] || return 0
    [ -z "${DOCKER_HOST:-}" ] || return 0

    local endpoint
    endpoint="$(node_ssh_endpoint)"
    if [ -z "$endpoint" ]; then
        echo "❌ ERROR: No SSH endpoint recorded for node '$LDM_NODE_TARGET'."
        echo "   Every docker call in this script would address this host instead."
        return 1
    fi

    export DOCKER_HOST="ssh://$endpoint"
    echo "🐳 Routing docker to '$LDM_NODE_TARGET' ($DOCKER_HOST)."
}

if ! route_docker_to_node; then
    exit 1
fi

# HARDENING: Proactively remove any existing project before we build.
#
# This used to be guarded by `[ -d "$PROJECT_NAME" ]` - a *local*
# directory. A CI runner is ephemeral, so on a remote target there is never
# a local directory and the removal never ran, while the project itself sat
# on the node. A previous run's leftovers were therefore adopted rather
# than replaced: Liferay attached to a half-initialised database, booted in
# 40s instead of 231s, and failed with NoSuchCompanyException (#1122).
#
# It also called `ldm` rather than `ldm_cmd`, so even when it did run it
# removed a project on the wrong machine. `--node` is parsed ~80 lines
# above this, so the target is known; #1093 exempted this call from the
# ldm_cmd sweep on the stated grounds that it was not, which was wrong.
#
# Unconditional now, because "does a project exist over there" costs a
# round trip to answer and `rm --delete` on an absent project is a no-op.
if [ $EXISTING_PROJECT -eq 0 ]; then
    echo "🧹 Removing any stale '$PROJECT_NAME' before build..."
    ldm_cmd rm "$PROJECT_NAME" --delete -y 2>/dev/null || true
    rm -rf "$PROJECT_NAME"
fi




echo "🚀 Starting AICA E2E Orchestration..."

# Truncate raw logs to prevent Forensic Log Analyzer false-positives from legacy runs
mkdir -p logs
rm -f logs/e2e-microservice.log
touch logs/e2e-microservice.log

# --- Phase 0: Environment Loading ---

# Save original global database mode to prevent configuration pollution
ACTIVE_MODE_LINE=$(ldm config database-mode 2>/dev/null || echo "")
if [[ "$ACTIVE_MODE_LINE" == *"shared"* ]]; then
    ORIGINAL_DB_MODE="shared"
elif [[ "$ACTIVE_MODE_LINE" == *"isolated"* ]]; then
    ORIGINAL_DB_MODE="isolated"
else
    ORIGINAL_DB_MODE=""
fi

# Installed here, immediately after ORIGINAL_DB_MODE is known, because that is
# the last thing cleanup reads. It used to sit 200 lines further down, after
# the readiness wait - so any failure before that point exited with no
# teardown at all: the project, its containers and its database volume were
# left on the node.
#
# That made failures contagious. A run that died at readiness left a
# half-initialised aica-e2e behind, and the next run attached to it instead of
# building its own: Liferay booted in 40s rather than 231s, found no company
# row, and failed the same way for a different reason (#1122).
#
# Everything cleanup calls - write_signal, ldm_cmd, ldm - is defined above.

# logs/e2e-microservice.log was created, truncated and never written to. It
# was written by a locally-run microservice; once the extension became a
# container its output went to the node's docker daemon and the artifact has
# been uploaded empty ever since - 166 bytes, on every run.
#
# That is not cosmetic. Diagnosing the Phase 5 401s meant reading the
# microservice's own errors, and the artifact that exists to carry them could
# not: the evidence was on the node and the file was on the runner. Reaching
# for it from a workstation instead contended with the run's own SSH.
#
# Captured in cleanup, before `ldm rm` destroys the container, and defined
# immediately above its caller: a helper used before its definition aborts an
# unguarded ldm_cmd at 127, and inside a trap that would replace the run's real
# failure with "command not found".
#
# Nothing here is fatal. A diagnostic that can fail the run it is diagnosing is
# worse than no diagnostic.
capture_microservice_diagnostics() {
    local container facts stage tmp
    stage="${1:-teardown}"
    facts="logs/e2e-microservice-container-${stage}.txt"
    mkdir -p logs

    container=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -i "microservice" | head -1)
    # LDM names the Liferay service after the project itself.
    LIFERAY_CONTAINER="${PROJECT_NAME:-aica-e2e}"

    if [ -z "$container" ]; then
        # Also what a dead daemon looks like: `docker ps` fails, the name list
        # is empty, and nothing distinguishes that from "not deployed yet".
        {
            echo "stage: $stage"
            echo "No microservice container found on the target; nothing to capture."
            echo "docker ps exit status: $(docker ps -a >/dev/null 2>&1; echo $?)"
        } > "$facts"
        return 0
    fi

    # Written via a temp file and only promoted when it has content, so a
    # teardown capture that reaches a dead daemon cannot blank the log an
    # earlier capture already collected.
    tmp=$(mktemp)
    if docker logs "$container" > "$tmp" 2>&1 && [ -s "$tmp" ]; then
        mv "$tmp" logs/e2e-microservice.log
    else
        rm -f "$tmp"
    fi

    {
        echo "container: $container"
        echo "stage: $stage"
        echo
        echo "=== ExtraHosts ==="
        docker inspect -f '{{json .HostConfig.ExtraHosts}}' "$container" 2>&1
        echo
        # The Liferay URL the SDK resolves comes from these. Values are printed
        # for the LXC and URL variables because they are hostnames, and names
        # only for anything credential-shaped.
        echo "=== environment ==="
        docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>&1 \
            | sed -E 's/^([A-Z_]*(SECRET|PASSWORD|TOKEN|KEY|PAT)[A-Z_]*)=.*/\1=<redacted>/'
        echo
        echo "=== /etc/hosts ==="
        docker exec "$container" cat /etc/hosts 2>&1 || echo "(container not running)"
        echo
        echo "=== does the project host resolve from inside? ==="
        # Defaulted: cleanup runs on every exit, including before host
        # resolution has set TARGET_HOST.
        local host="${TARGET_HOST:-<unresolved>}"
        docker exec "$container" getent hosts "$host" 2>&1 || echo "(no resolution for $host)"
        echo
        # The LXC config trees, at the paths the image itself declares.
        #
        # Derived from the container's own environment rather than hardcoded,
        # for the same reason LDM derives the mount target rather than
        # assuming it: an extension may name a non-standard path. The
        # fallbacks are the LXC convention.
        #
        # This is what answers liferay-docker-manager#1915 - whether Liferay's
        # generated OAuth2 client id and secret reach the container through
        # ext-init-metadata. Until LDM-#1928 nothing was mounted there at all.
        #
        # Names only, never contents: the files published here are
        # credentials.
        echo "=== LXC config trees ==="
        docker exec "$container" sh -c '
            dxp="${LIFERAY_ROUTES_DXP:-/etc/liferay/lxc/dxp-metadata}"
            ext="${LIFERAY_ROUTES_CLIENT_EXTENSION:-/etc/liferay/lxc/ext-init-metadata}"
            for d in "$dxp" "$ext"; do
                echo "--- $d ---"
                if [ -d "$d" ]; then
                    ls -A "$d" 2>&1 || echo "  (unreadable)"
                    [ -z "$(ls -A "$d" 2>/dev/null)" ] && echo "  (mounted, empty)"
                else
                    echo "  (path does not exist - nothing mounted here)"
                fi
            done' 2>&1 || echo "(config trees unreadable)"
        echo
        # /opt/liferay/routes is the application's own code, not a config
        # tree. Listed as a canary: if it is ever empty, a bind mount has
        # shadowed the route handlers and the container will not start
        # (liferay-docker-manager#1911).
        # Asked for by LDM to settle two questions outright.
        #
        # 1. `ls routes/default/` on the host. A directory that is not the one
        #    mounted means an ext-id mismatch - a one-line fix. Only `dxp`
        #    means Liferay never registered the extension, which is a
        #    different problem upstream of the mount.
        #
        #    Read through the Liferay container, which mounts the same host
        #    tree at /opt/liferay/routes. That is also the side that writes,
        #    so its view is the one that matters - and `-l` shows the
        #    ownership, which is what `(Permission denied)` turns on.
        echo "=== routes/default, as the Liferay container sees it ==="
        docker exec "$LIFERAY_CONTAINER" sh -c \
            'ls -la /opt/liferay/routes/default/ 2>&1; echo "--- whoami ---"; id' 2>&1 \
            || echo "(Liferay container '"'"'$LIFERAY_CONTAINER'"'"' not reachable)"
        echo
        # 2. Whether compose actually gated this service on Liferay. The
        #    generated depends_on is recorded as a label, so the running
        #    container is the authority rather than a file on the node.
        echo "=== compose depends_on for this service ==="
        docker inspect -f '{{index .Config.Labels "com.docker.compose.depends_on"}}' \
            "$container" 2>&1 || echo "(label unreadable)"
        echo
        echo "=== /opt/liferay/routes (app code - must NOT be empty) ==="
        docker exec "$container" sh -c 'ls -A /opt/liferay/routes 2>&1 | wc -l' 2>&1 \
            || echo "(unreadable)"
    } > "$facts" 2>&1

    echo "🔎 Captured microservice container diagnostics ($stage) -> $facts"
}

cleanup() {
    local exit_code=$?

    # Before anything that talks to the node, so a hung tunnel cannot delay
    # teardown of a billable instance.
    # Defined with the tunnel, far below this point. An exit before then
    # has no tunnel to close, and calling an undefined function inside the
    # trap would replace the run's real failure with "command not found".
    command -v close_node_tunnel >/dev/null 2>&1 && close_node_tunnel
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
        capture_microservice_diagnostics teardown || true
        echo -e "\n🧹 Cleaning up environment..."
        # shellcheck disable=SC2086
        ldm_cmd rm "$PROJECT_NAME" --delete $LDM_Y_FLAG || true
        echo "✨ Done."
    fi
    if [ -n "$ORIGINAL_DB_MODE" ]; then
        echo -e "\n🔄 Restoring global database mode to '$ORIGINAL_DB_MODE'..."
        ldm config database-mode "$ORIGINAL_DB_MODE" --global &>/dev/null || true
    fi

    if [ -n "$LDM_NODE_TARGET" ] && [ "$LDM_NODE_TARGET" != "local" ] && [ -f "./scripts/node_power.sh" ]; then
        echo -e "\n💤 Returning remote target node '$LDM_NODE_TARGET' to sleep..."
        # Not fatal - this runs from the EXIT trap, and exiting non-zero here
        # would replace the run's own exit code - but never silent either: a
        # node that will not power off keeps costing money until something
        # notices. In CI the workflow's mandatory sleep step is the backstop.
        if ! ./scripts/node_power.sh sleep "$LDM_NODE_TARGET"; then
            echo "⚠️  WARNING: Could not power off target node '$LDM_NODE_TARGET'. It may still be running and billable."
        fi
    fi
}

trap cleanup EXIT


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
# Reads Bundle-SymbolicName from a jar's manifest, or nothing when it cannot be
# read. The header may carry directives (com.example;singleton:=true), which are
# stripped, and manifests use CRLF line endings.
bundle_symbolic_name() {
    local jar="$1"
    unzip -p "$jar" META-INF/MANIFEST.MF 2>/dev/null \
        | tr -d '\r' \
        | awk -F': *' 'tolower($1) == "bundle-symbolicname" { split($2, a, ";"); print a[1]; exit }'
}

# Sync OSGi module jars built by Gradle into the LDM staging directory.
#
# This lives in one place because it previously existed twice - once on the
# fresh-init path and once for hot-deploy - and the two disagreed. The
# fresh-init copy also deleted
# com.liferay.accelerator.reindex.endpoint-1.0.0.jar, described as "the legacy
# JAX-RS 2.x reindex endpoint bundle". That module was already jakarta when the
# delete was added, so the name matched the current bundle instead: fresh-init
# environments shipped without the reindex endpoint, and because both
# triggerReindex callers only log a warning, the resulting 404 was silent.
# See #614.
#
# Prunes by Bundle-SymbolicName, never by filename. Modules now carry real
# versions, so a version bump changes the filename and a plain copy would leave
# both jars behind - two bundles with the same symbolic name, which OSGi treats
# as a duplicate. Only a jar whose symbolic name is being replaced is removed,
# so anything the .ldmp package shipped into osgi/modules under a different
# name is left alone. Matching on a filename is what made the old exclusion
# unable to tell a stale bundle from the current one. See #614.
# Writes the activation key the run was given into the project, where Liferay
# reads it at boot.
#
# The image's built-in trial licence expires thirty days after the release it
# was built from, and the pinned tag is older than that - so without a key the
# portal answers every request with its activation page, login included, and
# the suite fails four different ways none of which name the cause (#805).
#
# Same route as the portal-ext.properties rewrite below: written into the
# project directory after `ldm import --no-run` and before `ldm run`, so LDM
# carries it to the target node like everything else in there. Not written to
# the runner's home or passed on a command line.
#
# Base64 because GitHub masks secrets line by line, and a multi-line XML value
# can surface fragments in a log that masking does not catch. It also survives
# the shell exactly, which matters: a licence mangled by quoting fails the same
# way as one that is absent.
#
# Absent secret means no file and no change in behaviour, so this is inert
# until someone sets it - a local run without one behaves exactly as before.
# Which secret holds the licence for the node this run targets.
#
# Activation keys are issued against a specific machine, so one licence cannot
# serve every node. The variable is named after the target - `aws-1` reads
# LIFERAY_LICENSE_AWS_1 - which makes sending one node's licence to another a
# naming error rather than a silent activation failure twenty minutes in.
#
# LIFERAY_LICENSE remains the unqualified fallback, so a local run and a
# single-licence setup both keep working untouched.
license_env_var() {
    local target="${LDM_NODE_TARGET:-local}"

    if [ -z "$target" ] || [ "$target" = "local" ]; then
        echo "LIFERAY_LICENSE"
        return 0
    fi

    echo "LIFERAY_LICENSE_$(printf '%s' "$target" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9\n' '_')"
}

deploy_activation_key() {
    local var
    var=$(license_env_var)

    local license="${!var:-}"
    local source_var="$var"

    if [ -z "$license" ] && [ "$var" != "LIFERAY_LICENSE" ]; then
        license="${LIFERAY_LICENSE:-}"
        source_var="LIFERAY_LICENSE"

        if [ -n "$license" ]; then
            echo "⚠️  $var is not set; falling back to LIFERAY_LICENSE for node '${LDM_NODE_TARGET}'."
            echo "   An activation key issued for a different machine will not activate this one."
        fi
    fi

    if [ -z "$license" ]; then
        echo "ℹ️  Neither $var nor LIFERAY_LICENSE is set; deploying no activation key."
        echo "   An unactivated DXP serves its activation page for every request (#805)."
        return 0
    fi

    # deploy/, not data/license.
    #
    # The activation key is an input to auto-deploy: Liferay processes it out of
    # `deploy`, validates it, and writes the registered licence into
    # `data/license` itself as a serialized `.li` file, removing the key as it
    # goes. `data/license` is therefore an output directory - Liferay reads
    # everything in it with an ObjectInputStream, so an activation key left
    # there fails with `StreamCorruptedException: invalid stream header` and is
    # ignored. That looks exactly like an invalid or wrong-version licence and
    # is neither; it is the key being in the wrong place (#805).
    local deploy_dir="$PROJECT_NAME/deploy"
    local license_file="$deploy_dir/activation-key.xml"

    mkdir -p "$deploy_dir"

    # Written verbatim: the secret holds the activation key exactly as the file
    # does, so there is nothing to decode and no encoding step to get wrong.
    printf '%s' "$license" > "$license_file"

    # An empty or truncated secret would otherwise be discovered as an
    # activation failure twenty minutes later.
    if ! grep -q "<license" "$license_file" 2>/dev/null; then
        echo "❌ ERROR: $source_var does not contain a Liferay licence."
        rm -f "$license_file"
        return 1
    fi

    # Readable by the container's `liferay` user (uid 1000), which is not the
    # user that writes it. 0600 is unreadable from inside the container.
    chmod 644 "$license_file"
    echo "🔑 Activation key from $source_var deployed to $license_file"
}

sync_osgi_modules() {
    local context="${1:-}"

    if [ ! -d "bundles/osgi/modules" ]; then
        echo "No bundles/osgi/modules directory; skipping OSGi module sync${context}."
        return 0
    fi

    local jars=()
    while IFS= read -r jar; do
        jars+=("$jar")
    done < <(find bundles/osgi/modules -maxdepth 1 -name '*.jar' -type f | sort)

    if [ ${#jars[@]} -eq 0 ]; then
        echo "No built OSGi modules found to sync${context}."
        return 0
    fi

    # Gradle's output directory is never cleaned, so after a version bump it
    # holds both jars. Keep the most recently built one per symbolic name -
    # sorting by filename would pick 1.10.0 before 1.9.0 - and say which was
    # skipped rather than dropping it silently.
    local newest=()
    local candidate candidate_bsn other other_bsn superseded
    for candidate in "${jars[@]}"; do
        candidate_bsn="$(bundle_symbolic_name "$candidate")"
        superseded=""

        if [ -n "$candidate_bsn" ]; then
            for other in "${jars[@]}"; do
                [ "$other" = "$candidate" ] && continue
                other_bsn="$(bundle_symbolic_name "$other")"
                if [ "$other_bsn" = "$candidate_bsn" ] && [ "$other" -nt "$candidate" ]; then
                    superseded="$other"
                    break
                fi
            done
        fi

        if [ -n "$superseded" ]; then
            echo "   ! skipping $(basename "$candidate"); $(basename "$superseded") is newer"
        else
            newest+=("$candidate")
        fi
    done
    jars=("${newest[@]}")

    echo "Syncing ${#jars[@]} OSGi module(s) to LDM modules directory${context}..."
    mkdir -p "$PROJECT_NAME/osgi/modules"

    local jar bsn existing
    for jar in "${jars[@]}"; do
        bsn="$(bundle_symbolic_name "$jar")"

        if [ -n "$bsn" ]; then
            while IFS= read -r existing; do
                [ "$(basename "$existing")" = "$(basename "$jar")" ] && continue
                if [ "$(bundle_symbolic_name "$existing")" = "$bsn" ]; then
                    echo "   - removing superseded $(basename "$existing")"
                    rm -f "$existing"
                fi
            done < <(find "$PROJECT_NAME/osgi/modules" -maxdepth 1 -name '*.jar' -type f)
        else
            echo "   ! $(basename "$jar") has no Bundle-SymbolicName; copying without pruning"
        fi

        cp "$jar" "$PROJECT_NAME/osgi/modules/"
        echo "   - $(basename "$jar")"
    done
}

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



# If project directory is on a secondary volume (e.g. /Volumes/), set TMPDIR to a temp folder on that volume
# to prevent Python os.rename [Errno 18] Cross-device link errors in LDM packaging.
PROJECT_DIR_REAL=$(pwd -P)
if [[ "$PROJECT_DIR_REAL" == /Volumes/* ]]; then
    VOLUME_ROOT=$(echo "$PROJECT_DIR_REAL" | cut -d'/' -f1-3)
    mkdir -p "$VOLUME_ROOT/tmp" 2>/dev/null || true
    export TMPDIR="$VOLUME_ROOT/tmp"
    echo "📁 Secondary volume detected ($VOLUME_ROOT); set TMPDIR=$TMPDIR for LDM cross-device safety."
fi

host_is_resolvable() {
    getent hosts "$TARGET_HOST" &>/dev/null \
        || nslookup "$TARGET_HOST" &>/dev/null \
        || ping -c 1 -W 1 "$TARGET_HOST" &>/dev/null
}

# The URL of the target host itself. This is the one place the protocol/port
# decision is made; LIFERAY_URL, LIFERAY_API_URL and BASE_URL are all derived
# from its result rather than repeating it.
host_url() {
    local host="$1"

    if [ $NO_SSL -eq 1 ]; then
        echo "http://$host"
    else
        echo "https://$host$SSL_PORT_SUFFIX"
    fi
}

# The client extensions are served by the same proxy on their own subdomains,
# so they take the same protocol and port decision rather than a second one.
target_host_url() {
    host_url "$TARGET_HOST"
}

# The fallback for an unresolvable host: Tomcat on whichever host port docker
# mapped 8080 to, which is only knowable once the container exists.
mapped_container_url() {
    local port_binding resolved_port
    port_binding=$(docker port "$PROJECT_NAME" 8080 2>/dev/null || echo "")
    if [ -n "$port_binding" ]; then
        resolved_port=$(echo "$port_binding" | head -n 1 | cut -d':' -f2)
    else
        resolved_port="8080"
    fi
    echo "http://localhost:$resolved_port"
}

# TARGET_URL must never be empty: everything downstream is derived from it, and
# every one of those consumers has its own silent localhost:8080 default. When
# it was assigned only on the unresolvable path, CI - where /etc/hosts always
# makes the host resolvable - ran for 1h53m against a port nothing listens on
# and reported it as a Liferay startup timeout, 40 nightly runs in a row. Name
# the variable and stop. See #707.
assert_target_url() {
    if [ -n "$TARGET_URL" ]; then
        return 0
    fi
    echo "❌ ERROR: TARGET_URL is empty after $1."
    echo "   Every downstream consumer (BASE_URL, LIFERAY_URL, LIFERAY_API_URL,"
    echo "   Playwright and the microservice) derives from TARGET_URL, and each"
    echo "   silently falls back to localhost:8080 when it is unset."
    exit 1
}

# Everything the rest of the run - and the containers it starts - reads for the
# Liferay under test. Called again wherever TARGET_URL changes, so no consumer
# can be left holding a URL the resolution has since moved on from.
export_target_urls() {
    assert_target_url "$1"
    export BASE_URL="$TARGET_URL"
    export LIFERAY_URL="$TARGET_URL"
    export LIFERAY_API_URL="$TARGET_URL"
    export COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL="${TARGET_URL%%:*}"
    export COM_LIFERAY_LXC_DXP_MAIN_DOMAIN="$TARGET_HOST"
    echo "🎯 Target resolved after $1: TARGET_URL=$TARGET_URL (protocol=$COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL, domain=$COM_LIFERAY_LXC_DXP_MAIN_DOMAIN)"
}

# TARGET_URL starts as the target host's own URL and is only replaced by the
# localhost fallback when the host cannot be resolved. Assigning it in one
# branch and reading it in another is precisely the bug in #707.
TARGET_URL="$(target_host_url)"
if host_is_resolvable; then
    echo "ℹ  Host '$TARGET_HOST' is resolvable. Using: $TARGET_URL"
else
    echo "⚠️  Host '$TARGET_HOST' is not resolvable."
    if [ $EXISTING_PROJECT -eq 1 ]; then
        TARGET_URL="$(mapped_container_url)"
        echo "ℹ  Falling back to the container's mapped port: $TARGET_URL"
    else
        echo "ℹ  Keeping $TARGET_URL until the project exists and its mapped port can be read."
    fi
fi

export_target_urls "host resolution"

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

LDM_SSL_FLAG=""
if [ $NO_SSL -eq 1 ]; then
    LDM_SSL_FLAG="--no-ssl"
fi

# --- Concurrency Safety Check ---
# The heavy generation/import flows in this suite are resource-intensive; running
# them alongside other active LDM projects risks contention that's hard to tell
# apart from real regressions (see AICA issue #445). If we're also remapping the
# shared proxy's SSL port, other running projects would lose HTTPS access entirely,
# so that's never allowed regardless of --allow-concurrent.
OTHER_RUNNING=$(other_running_ldm_projects)
if [ -n "$OTHER_RUNNING" ]; then
    echo "⚠️  Other LDM project(s) currently running: $(echo "$OTHER_RUNNING" | tr '\n' ' ')"
    if [ -n "$SSL_PORT" ]; then
        echo "❌ ERROR: --ssl-port cannot be used while other LDM projects are running -"
        echo "   remapping the shared proxy's SSL port would break their HTTPS access."
        echo "   Stop them first (ldm rm <project> --delete)."
        exit 1
    fi
    if [ $ALLOW_CONCURRENT -eq 0 ]; then
        echo "❌ ERROR: Refusing to start the E2E suite alongside other running LDM projects."
        echo "   Stop them first (ldm rm <project> --delete), or pass --allow-concurrent to override."
        exit 1
    fi
    echo "🔓 --allow-concurrent set; proceeding despite other running project(s)."
fi

echo "🔍 Running LDM Doctor (Silent)..."
if ! ldm_cmd doctor --skip-project > /dev/null; then
    echo "⚠️  WARNING: LDM Doctor reported environment warnings. Continuing..."
fi

echo "🔧 Enforcing isolated database mode..."
ldm config database-mode isolated --global

INFRA_SETUP_ARGS=()
if [ -n "$SSL_PORT" ]; then
    # --force-recreate is required even on a fresh proxy container: infra setup
    # otherwise preserves whatever port an already-running proxy is bound to.
    INFRA_SETUP_ARGS+=(--ssl-port "$SSL_PORT" --force-recreate)
fi

echo "🏗️  Ensuring LDM Shared Infrastructure is active..."
# There was a `config set database_mode shared` here. It never took effect and
# it contradicted the line above.
#
# `ldm config set` writes the root of ~/.ldmrc, which LDM's defaults resolver
# ignores whenever a `defaults` block exists - so the setting was silently
# dropped. LDM 2.21.1 stopped accepting the command at all and now refuses it,
# which is what began failing the nightly E2E:
#
#   'database_mode' is a cascading default, not a plain config value.
#
# Deleted rather than translated to `ldm config defaults database_mode shared`.
# Ten lines above, this script sets `database-mode isolated --global` and calls
# that "Enforcing isolated database mode" - the deliberate intent, added in
# c8f5c3d7. The shared line arrived seventeen minutes later as the only script
# change in 902c4f4e, a commit about health status. Making it work now would
# override the isolated mode on purpose for the first time, which is a change
# to how the suite runs, not a repair.
docker rm -f liferay-docker-proxy liferay-proxy-global 2>/dev/null || true
# shellcheck disable=SC2086
ldm_cmd infra-setup $LDM_Y_FLAG "${INFRA_SETUP_ARGS[@]}"

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

# Strip autogenerated Dockerfile from static client extensions BEFORE LDM import
# to prevent workspace.py from misidentifying them as Docker services
find client-extensions bundles/osgi/client-extensions -name "*.zip" 2>/dev/null | while read -r zip; do
    if [[ ! "$zip" == *"microservice"* ]]; then
        zip -d "$zip" Dockerfile >/dev/null 2>&1 || true
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

    # The .ldmp seed was packaged with 'shared' DB mode, so its portal-ext.properties hardcodes liferay-db-global.
    # We must dynamically rewrite it to use the isolated project DB before booting.
    if [ -f "$PROJECT_NAME/files/portal-ext.properties" ]; then
        echo "🔧 Rewriting database host in portal-ext.properties for isolated DB mode..."
        sed -i.bak "s/liferay-db-global/${PROJECT_NAME}-db/g" "$PROJECT_NAME/files/portal-ext.properties"
    fi

    deploy_activation_key

    sync_osgi_modules

    # Sync client extensions built by Gradle/yarn into the LDM staging directory
    # NOTE: We copy all ZIPs EXCEPT the Site Initializer here. 
    # If the Site Initializer is copied before Liferay boots, it is processed during startup, 
    # which causes NPEs in the SiteInitializerClientExtension because Liferay's default 
    # layouts and portal contexts are not yet fully initialized.
    # However, the OAuth client extension MUST be present so LDM can generate credentials.
    echo "🔄 Syncing built client extensions to LDM staging directory (excluding Site Initializer)..."
    mkdir -p "$PROJECT_NAME/osgi/client-extensions"
    if [ -d "bundles/osgi/client-extensions" ]; then
        for zip in bundles/osgi/client-extensions/*.zip; do
            if [[ -f "$zip" && ! "$zip" == *"site-initializer"* ]]; then
                cp "$zip" "$PROJECT_NAME/osgi/client-extensions/" 2>/dev/null || true
            fi
        done
    fi
    # Fallback to source dist/build folders if standalone build was used
    find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) ! -name "*site-initializer*" -exec cp {} "$PROJECT_NAME/osgi/client-extensions/" \; 2>/dev/null || true

    # There is deliberately no LIFERAY_API_URL injection here.
    #
    # One used to write env.LIFERAY_API_URL into the staged extension's
    # LCP.json. It never reached the container. It ran, and reported success:
    #
    #     ai-commerce-accelerator-microservice.zip: env.LIFERAY_API_URL = https://...
    #
    # while the container's own environment showed the variable absent
    # (measured, run 35816192072). LDM parses an extension's LCP.json from
    # `ce_dir` - <project>/client-extensions - and the injection targeted
    # `cx` - <project>/osgi/client-extensions. Two directories:
    #
    #     "cx":     root / "osgi" / "client-extensions"
    #     "ce_dir": root / "client-extensions"
    #
    # The microservice has no Liferay URL because LDM's stack.py ->
    # composer.py refactor dropped LIFERAY_LXC_DXP_MAIN_DOMAIN and _DOMAINS
    # from every client-extension container, and lxcConfig.dxpMainDomain()
    # resolves from exactly those (liferay-docker-manager#1918). That is fixed
    # upstream on master and is not in v2.25.0, which this run pins.
    #
    # Repairing the injection to target ce_dir was considered and rejected:
    # the upstream fix removes the need for it entirely, so it would be
    # thrown away. If you are here because the 401s are back, check the LDM
    # version before writing any of this again.

    chmod -R 777 "$PROJECT_NAME" 2>/dev/null || true

    write_signal "STARTING"
    echo "⚡ Starting Liferay container with tag [$LIFERAY_TAG] (Detached + Sidecar)..."
    # LDM 2.7.12+ automatically:
    # 1. Detects and handles external volume locking (--internal-state)
    # 2. Forwards AI environment variables (OPENAI_*, GEMINI_*, etc.)
    # LDM 2.8.0+ supports --lean for constrained environments.
    RUN_ARGS=(
        run "$PROJECT_NAME"
        --host-name "$TARGET_HOST"
        --tag "$LIFERAY_TAG"
        --sidecar
        --no-captcha
        --no-wait
        --jvm-args=-Xmx2560m
        --fast-login
        --feature LPD-35443
        -y
    )
    if [ -n "$LDM_SSL_FLAG" ]; then
        RUN_ARGS+=("$LDM_SSL_FLAG")
    fi
    docker rm -f liferay-docker-proxy 2>/dev/null || true
    ldm_cmd "${RUN_ARGS[@]}"

else
    echo "⏭️  Skipping initialization/boot for existing project '$PROJECT_NAME'."

    sync_osgi_modules " for hot-deploy"

    # Sync client extensions to the LDM staging directory for hot-deploy
    echo "🔄 Syncing built client extensions to LDM staging directory for hot-deploy..."
    mkdir -p "$PROJECT_NAME/osgi/client-extensions"
    find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) -exec cp {} "$PROJECT_NAME/osgi/client-extensions/" \; 2>/dev/null || true

    # Copy LDM configuration directory if it exists
    if [ -d ".ldm" ]; then
        echo "🔄 Copying .ldm configuration directory to LDM staging directory..."
        cp -r .ldm "$PROJECT_NAME/"
    fi

    # Strip autogenerated Dockerfile from static client extensions to prevent LDM misidentifying them as Docker services
    for zip in "$PROJECT_NAME/osgi/client-extensions/"*.zip; do
        if [[ -f "$zip" && ! "$zip" == *"microservice"* ]]; then
            zip -d "$zip" Dockerfile >/dev/null 2>&1 || true
        fi
    done

    chmod -R 777 "$PROJECT_NAME" 2>/dev/null || true
fi

# Re-resolve the fallback URL now the container exists: on a fresh project the
# mapped Tomcat port was unknowable the first time round.
if ! host_is_resolvable && docker port "$PROJECT_NAME" 8080 &>/dev/null; then
    TARGET_URL="$(mapped_container_url)"
    export_target_urls "the container's mapped port became readable"
fi

# --- Remote node tunnel ---
#
# Playwright runs here; the stack runs on the compute node. The browser has to
# reach Liferay, and the certificate LDM issues names $TARGET_HOST - so reaching
# the stack by the node's address can never validate, whatever the security
# group allows.
#
# Forwarding the node's ports onto this host's loopback makes the hosts entry
# ($TARGET_HOST -> 127.0.0.1) true rather than wrong: the name the browser asks
# for is the name on the certificate, and TARGET_URL needs no special case for
# remote. It also means nothing is exposed publicly - the traffic rides the SSH
# connection LDM already authenticates for (#1085).
NODE_TUNNEL_PID=""
NODE_TUNNEL_SUDO=0

# The ports the tunnel binds locally, and the one its readiness is judged by.
# One definition, because a probe that checks a different port than the forward
# binds is answering a question nobody asked - on a local run the real proxy
# already holds 443, so probing it reported a tunnel up that had not started.
TUNNEL_HTTPS_PORT="${TUNNEL_HTTPS_PORT:-443}"
TUNNEL_HTTP_PORT="${TUNNEL_HTTP_PORT:-80}"

tunnel_is_listening() {
    (exec 3<>/dev/tcp/127.0.0.1/"$TUNNEL_HTTPS_PORT") 2>/dev/null && exec 3<&- 3>&-
}

# The command the tunnel would run, one argument per line.
#
# Separated so its guard can assert the command without executing anything.
# Testing it by shimming a `chmod +x` stub named `ssh` onto PATH means every
# run spawns a process called `ssh` holding a `-L` port-forward to a remote
# host with host key checking off - which is a lateral-movement signature to
# endpoint protection, whatever the binary really is. LDM hit the same thing
# twice (LDM-#1898, LDM-#1899) with `lfr-tunnel` and `ldm`.
#
# `ssh_probe_command()` in manage_target_nodes.py is the same idea; this
# brings the shell side into line with it.
node_tunnel_command() {
    local key="${LDM_SSH_KEY:-$HOME/.ssh/aws-key.pem}"

    # Explicit -i, unlike the callers #1085 was about: this caller knows the
    # key, and under sudo it runs as root, whose ~/.ssh is not the one CI
    # configured.
    [ -f "$key" ] && printf '%s\n' -i "$key"

    # 443 and 80 by default: the certificate names $TARGET_HOST with no port,
    # and Liferay builds absolute URLs from the same host name.
    printf '%s\n' \
        -N \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=30 \
        -o BatchMode=yes \
        -L "${TUNNEL_HTTPS_PORT}:localhost:443" \
        -L "${TUNNEL_HTTP_PORT}:localhost:80"
}

open_node_tunnel() {
    [ -n "${LDM_NODE_TARGET:-}" ] && [ "$LDM_NODE_TARGET" != "local" ] || return 0

    local endpoint waited=0 tunnel_arg
    local ssh_args=() sudo_prefix=()

    endpoint="$(node_ssh_endpoint)"
    if [ -z "$endpoint" ]; then
        echo "❌ ERROR: No SSH endpoint recorded for node '$LDM_NODE_TARGET'."
        echo "   The wake step writes it to ~/.ldmrc and .node-power-config.json; neither had a host."
        return 1
    fi

    # Read loop rather than mapfile: this script runs under /bin/bash, which
    # on macOS is 3.2 and has no mapfile. It would have failed for every
    # developer and passed in CI.
    ssh_args=()
    while IFS= read -r tunnel_arg; do
        ssh_args+=("$tunnel_arg")
    done < <(node_tunnel_command)

    # 443 and 80 specifically: the certificate names $TARGET_HOST with no port,
    # and Liferay builds absolute URLs from the same host name.
    if [ "$(id -u)" -ne 0 ]; then
        sudo_prefix=(sudo)
        NODE_TUNNEL_SUDO=1
    fi

    echo "🔌 Forwarding ${endpoint#*@}:443 and :80 onto this host so '$TARGET_HOST' reaches the stack..."
    "${sudo_prefix[@]}" "${TUNNEL_SSH_BIN:-ssh}" "${ssh_args[@]}" "$endpoint" &
    NODE_TUNNEL_PID=$!

    until tunnel_is_listening; do
        if ! kill -0 "$NODE_TUNNEL_PID" 2>/dev/null; then
            NODE_TUNNEL_PID=""
            echo "❌ ERROR: The tunnel to $endpoint exited immediately."
            echo "   ExitOnForwardFailure is set, so this is a bind or authentication failure, not a slow start."
            return 1
        fi
        if [ "$waited" -ge "${TUNNEL_READY_TIMEOUT:-30}" ]; then
            echo "❌ ERROR: Tunnel opened but nothing is listening on 127.0.0.1:443 after ${waited}s."
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done

    echo "✅ Tunnel up; '$TARGET_HOST' now reaches the stack on '$LDM_NODE_TARGET'."
}
close_node_tunnel() {
    [ -n "$NODE_TUNNEL_PID" ] || return 0
    echo "🔌 Closing the tunnel to '$LDM_NODE_TARGET'..."
    if [ "$NODE_TUNNEL_SUDO" -eq 1 ]; then
        sudo kill "$NODE_TUNNEL_PID" 2>/dev/null || true
    else
        kill "$NODE_TUNNEL_PID" 2>/dev/null || true
    fi
    NODE_TUNNEL_PID=""
}

# LDM gained --probe-url in 2.25.0-pre.2 (LDM-#1891). Without it, LDM derives
# the URL from the target and probes the node's address, which the tunnel makes
# both unnecessary and wrong. Detect it rather than pinning a version, so an
# older LDM still runs - it just probes as it always did.
PROBE_URL_ARGS=()
if ldm wait --help 2>&1 | grep -q -- '--probe-url'; then
    PROBE_URL_ARGS=(--probe-url "$TARGET_URL")
else
    echo "⚠️  This LDM has no --probe-url; readiness will probe the address it derives, not $TARGET_URL."
fi

if ! open_node_tunnel; then
    write_signal "UNHEALTHY"
    exit 1
fi

# --- Phase 4: Sync & Wait ---

write_signal "WAITING_HEALTHY"
echo "⏳ Waiting for Liferay HTTP layer to be ready at $TARGET_URL..."

# Reverting to manual bash log streaming to bypass Python/LDM subprocess buffering in CI
ldm_cmd logs -f "$PROJECT_NAME" &
LOG_PID=$!

# Wait for Liferay HTTP layer to become healthy FIRST
if ! ldm_cmd wait "$PROJECT_NAME" --timeout 1800 "${PROBE_URL_ARGS[@]}"; then
    write_signal "UNHEALTHY"
    echo -e "\n❌ ERROR: Liferay failed to become ready within 30 minutes."
    kill $LOG_PID 2>/dev/null || true
    exit 1
fi

echo -e "\n✅ Liferay Core is UP! Proceeding to deploy client extensions..."

# A DXP instance with no valid activation key answers every request with its
# "Liferay DXP Activation" page. Nothing downstream survives that: the fragment
# override PUTs get 302'd to /c/portal/license and retry for 38 minutes, the
# microservice's OAuth handshake fails, and Playwright's auth setup times out
# waiting for a login form that is never served. The suite still spent the full
# 1h55m per shard reaching that point, three shards a night, and reported it as
# a locator timeout. Check it once, here, while the run has cost two minutes.
assert_instance_is_activated() {
    local response status body
    # -L because an unregistered portal reaches its activation page by 302,
    # which is also how the fragment-override PUTs were being turned away.
    response=$(curl -sSkL --max-time 30 -w $'\n%{http_code}' "$TARGET_URL/c/portal/login" 2>/dev/null || echo "")
    status="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if [ -z "$status" ] || [ "$status" = "000" ]; then
        echo "⚠️  WARNING: Could not read $TARGET_URL/c/portal/login to confirm the"
        echo "   instance is activated. Continuing; a later step will report the"
        echo "   consequences if it is not."
        return 0
    fi

    case "$body" in
        *"This instance is not registered"*|*"Liferay DXP Activation"*)
            write_signal "UNACTIVATED"
            kill $LOG_PID 2>/dev/null || true
            echo -e "\n❌ ERROR: Liferay DXP is not activated."
            echo "   $TARGET_URL is serving the 'Liferay DXP Activation' page in place"
            echo "   of the login form, so no test can sign in and no API call can"
            echo "   authenticate."
            echo
            echo "   The docker image's built-in trial licence expires 30 days after"
            echo "   the release it was built from. gradle.properties pins"
            echo "   liferay.workspace.product=${LIFERAY_TAG:-$(grep 'liferay.workspace.product=' "$GRADLE_PROPS" | cut -d'=' -f2 | xargs)},"
            echo "   and this script deploys no activation key of its own, so the"
            echo "   environment has no way to become registered."
            echo
            echo "   Fix by making an activation key available to the run - a repository"
            echo "   secret written into '$PROJECT_NAME/files/data/license/' before"
            echo "   'ldm run' - rather than by moving the pinned tag, which is pinned to"
            echo "   match the shared OSGi modules (#738)."
            exit 1
            ;;
    esac

    echo "✅ Liferay instance is activated (HTTP $status on /c/portal/login)."
}

assert_instance_is_activated

# Now deploy the artifacts
ARTIFACTS=$(find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) 2>/dev/null)

if [ -z "$ARTIFACTS" ]; then
    echo "⚠️  WARNING: No artifacts found to deploy. Did the build fail?"
else
    echo "🚚 Syncing artifacts to container [$PROJECT_NAME] using native Atomic Move..."
    write_signal "DEPLOYING"
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
fi

# Export LDM_FRAGMENT_PATCH_TIMEOUT to give OSGi JAX-RS / Site Initializer processing adequate headroom (LDM #1021)
export LDM_FRAGMENT_PATCH_TIMEOUT="${LDM_FRAGMENT_PATCH_TIMEOUT:-900}"

# Finally wait for deployables to be processed (Custom Objects, OAuth apps, Site Initializer, etc)
# What the container actually received, not what we exported.
#
# Printed whole, with values masked. Two earlier versions were each one step
# short: the first printed a header and nothing else, which read the same
# whether the variables were absent or `docker exec` failed; the second
# filtered on ^(LIFERAY_|COM_LIFERAY_LXC_|LXC_) and so could not tell "absent"
# from "arrived under another name".
#
# That distinction matters here. LDM forwards some prefixes as-is and strips
# others - LDM_COMPANY_ID arrives as COMPANY_ID, and a service-targeted
# variable loses its service prefix too. A filter keyed on the name we exported
# cannot see a variable that was renamed on the way in, and would report it
# missing (#1106).
#
# The container holds around a dozen variables, so there is no reason to
# filter. Values are masked because LIFERAY_* can carry credentials, and the
# question is which names arrived, not what they hold.
MICROSERVICE_CONTAINER="${PROJECT_NAME}-ai-commerce-accelerator-microservice"

if container_env=$(docker exec "$MICROSERVICE_CONTAINER" env 2>&1); then
    env_total=$(printf '%s\n' "$container_env" | grep -c .)

    echo "🔎 $MICROSERVICE_CONTAINER holds $env_total environment variable(s):"
    printf '%s\n' "$container_env" \
        | sed 's/=.*/=<set>/' \
        | sort \
        | sed 's/^/     /'
else
    echo "⚠️  Could not read $MICROSERVICE_CONTAINER's environment; this says nothing about forwarding:"
    printf '%s\n' "$container_env" | sed 's/^/     /' | head -5
fi

echo "⏳ Waiting for Liferay Client Extensions (deployables) to be processed..."
DEPLOYABLES_READY=1
if ! ldm_cmd wait "$PROJECT_NAME" -d --timeout 180 "${PROBE_URL_ARGS[@]}"; then
    DEPLOYABLES_READY=0
    echo -e "\n⚠️  WARNING: Liferay deployables probe did not complete within 3 minutes; continuing to test execution."
fi

kill $LOG_PID 2>/dev/null || true

# This line used to be unconditional, so a run whose probe had just printed
# "Project is running but HTTP ... is not responding correctly" followed it
# immediately with "Liferay is UP and responding!". Anyone scanning the log for
# the first sign of trouble read the reassurance and moved on, which is a large
# part of why the nightly went unexplained for a month.
if [ $DEPLOYABLES_READY -eq 1 ]; then
    echo -e "\n✅ Liferay is UP and its deployables are processed."
    write_signal "HEALTHY"
else
    echo -e "\n⚠️  Continuing with Liferay UP but its deployables unconfirmed."
    write_signal "DEGRADED"
fi

# Give Liferay's embedded Elasticsearch 45s of idle CPU time to finish startup indexing on cold boots
if [ $EXISTING_PROJECT -eq 0 ]; then
    write_signal "INDEXING"
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

# Captured here as well as at teardown. A teardown-only capture asks the node
# for diagnostics at the one moment it is least likely to answer: run
# 35786135201 failed, and every docker call in cleanup then timed out after
# ~62s, so the capture recorded "no container found" against a stack that had
# been running for forty minutes. Here the stack is up and docker is known
# good, so the environment the microservice actually received is on record
# before anything can go wrong.
capture_microservice_diagnostics pre-tests || true

echo "🎭 Phase 5: Running Playwright E2E tests..."
# The microservice is reached through the proxy, not a published port.
#
# Nothing publishes to the host except the shared proxy. A run against a node
# listed every container:
#
#   aica-e2e                                       8000/tcp, 8080/tcp, …
#   aica-e2e-ai-commerce-accelerator-microservice  (nothing)
#   aica-e2e-db                                    5432/tcp
#   liferay-proxy-global                           0.0.0.0:80->80, 0.0.0.0:443->443
#
# The microservice publishes nothing - not even an exposed port - so
# http://localhost:<anything> could never reach it, on a node or on this host.
# Reading a port from it, and forwarding that port, were both chasing something
# that does not exist (#1099, #1089).
#
# The route that does exist is the one this script already requires: the proxy
# serves each client extension on its own subdomain, and Phase 1 fails the run
# if `ai-commerce-accelerator-microservice.$TARGET_HOST` does not resolve. On a
# node, 443 arrives there through the tunnel (#1087), so the same URL works
# either way and needs no port at all.
export_target_urls "the environment became ready"

MICROSERVICE_URL="$(host_url "ai-commerce-accelerator-microservice.${TARGET_HOST}")"

export AICA_MICROSERVICE_URL="$MICROSERVICE_URL"

# Liferay calls this from inside the node, where host.docker.internal pointed
# at a port nothing published. The proxy subdomain is the one address that
# resolves from both sides.
export LIFERAY_BATCH_CALLBACK_URL="${MICROSERVICE_URL}/api/v1/batch/callback"

echo "ℹ  Microservice reachable at $AICA_MICROSERVICE_URL"


# Attempt to fetch dynamic credentials from LDM
echo "🔑 Attempting to extract dynamic LDM credentials..."
# Also ldm_cmd: asking this host for a remote project's credentials returns
# nothing, and the fallback below is a *default* login. Playwright would then
# fail every spec at the login form - which reads as an application defect
# rather than a configuration one.
LDM_CREDS=$(ldm_cmd info "$PROJECT_NAME" --credentials --json 2>/dev/null || echo "")

if [ -n "$LDM_CREDS" ] && [ "$LDM_CREDS" != "[]" ]; then
    # Use Node.js to safely parse the JSON array and extract the 'admin' credential
    DYNAMIC_USER=$(node -e "try { const creds = JSON.parse(process.argv[1]); const admin = creds.find(c => c.type === 'admin'); if (admin) console.log(admin.email); } catch(e) {}" "$LDM_CREDS" 2>/dev/null)
    DYNAMIC_PASS=$(node -e "try { const creds = JSON.parse(process.argv[1]); const admin = creds.find(c => c.type === 'admin'); if (admin) console.log(admin.password); } catch(e) {}" "$LDM_CREDS" 2>/dev/null)
    
    if [ -n "$DYNAMIC_USER" ] && [ -n "$DYNAMIC_PASS" ]; then
        export LIFERAY_USER="$DYNAMIC_USER"
        export LIFERAY_PASSWORD="$DYNAMIC_PASS"
        echo "✅ Successfully loaded dynamic admin credentials from LDM."
    fi
fi

# Map CI secrets to standard AICA variables if provided (with dynamic LDM creds taking precedence if set)
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
