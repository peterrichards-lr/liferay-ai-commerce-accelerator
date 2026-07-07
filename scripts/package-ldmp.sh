#!/bin/bash
# scripts/package-ldmp.sh
# Packages the Liferay AI Commerce Accelerator environment into a standardized LDM package (.ldmp)
set -e

PROJECT_ID="liferay-ai-commerce-accelerator"
GIT_REPO="peterrichards-lr/liferay-ai-commerce-accelerator"
LIFERAY_TAG="2026.q1.7"
DB_TYPE="postgresql"

echo "📦 Packaging LDM Environment for: ${PROJECT_ID}"
echo "--------------------------------------------------"

# Cross-platform SHA-256 helper
calculate_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    node -e "const crypto = require('crypto'); const fs = require('fs'); console.log(crypto.createHash('sha256').update(fs.readFileSync('$1')).digest('hex'));"
  fi
}

# 1. Create a temporary staging directory
STAGING_DIR="./ldm_staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

FILES_STAGING="${STAGING_DIR}/files_staging"
mkdir -p "${FILES_STAGING}"

if [ -d ".ldm" ]; then
  echo "📂 Copying LDM configuration (.ldm) to staging..."
  cp -r ".ldm" "${FILES_STAGING}/"
fi

# 2. Manifest generation is deferred until staging files are collected.

# 3. Dump your Database state from the running postgres container
echo "💾 Dumping PostgreSQL database state..."
DB_CONTAINER=""
LIFERAY_CONTAINER=""

if docker ps --format '{{.Names}}' | grep -q "^aica-db$"; then
  DB_CONTAINER="aica-db"
elif docker ps --format '{{.Names}}' | grep -q "^liferay-ai-commerce-accelerator-db$"; then
  DB_CONTAINER="liferay-ai-commerce-accelerator-db"
else
  DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E "aica.*-db|liferay-ai-commerce-accelerator.*-db" | head -n 1)
fi

if docker ps --format '{{.Names}}' | grep -q "^aica$"; then
  LIFERAY_CONTAINER="aica"
elif docker ps --format '{{.Names}}' | grep -q "^liferay-ai-commerce-accelerator$"; then
  LIFERAY_CONTAINER="liferay-ai-commerce-accelerator"
else
  LIFERAY_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E "^aica$|^liferay-ai-commerce-accelerator$" | head -n 1)
fi

# Copy document library from running container if available
if [ -n "$LIFERAY_CONTAINER" ]; then
  echo "📥 Copying document_library from running container: ${LIFERAY_CONTAINER}..."
  mkdir -p bundles/data
  rm -rf bundles/data/document_library
  docker cp "${LIFERAY_CONTAINER}:/opt/liferay/data/document_library" bundles/data/
  echo "✅ Copied document_library successfully."
else
  echo "⚠️  WARNING: Running Liferay container not found. Skipping docker cp."
fi

if [ -n "$DB_CONTAINER" ]; then
  echo "🔌 Using database container: ${DB_CONTAINER}"
  docker exec "$DB_CONTAINER" pg_dump -U lportal lportal > "${STAGING_DIR}/database.sql"
  echo "✅ Database dump completed successfully."
else
  echo "⚠️  WARNING: Running database container not found. Including a blank SQL file."
  touch "${STAGING_DIR}/database.sql"
fi

# 4. Package directory assets (document_library) and compiled code
echo "📂 Archiving volume assets and deployments..."
FILES_STAGING="${STAGING_DIR}/files_staging"
mkdir -p "${FILES_STAGING}/deploy"
mkdir -p "${FILES_STAGING}/data"
mkdir -p "${FILES_STAGING}/client-extensions"

# Copy document library
if [ -d "bundles/data/document_library" ]; then
  cp -r "bundles/data/document_library" "${FILES_STAGING}/data/"
  echo "✅ Copied document_library to staging."
else
  echo "⚠️  WARNING: 'bundles/data/document_library' not found."
fi

# Copy compiled client extensions and modules
find client-extensions -name "*.zip" \( -path "*/dist/*" -o -path "*/build/*" \) -exec cp {} "${FILES_STAGING}/client-extensions/" \; 2>/dev/null || true
find modules -name "*.jar" -path "*/build/libs/*" -exec cp {} "${FILES_STAGING}/deploy/" \; 2>/dev/null || true

# Archive files_staging into files.tar.gz
if [ -d "${FILES_STAGING}/data/document_library" ] || [ "$(ls -A "${FILES_STAGING}/deploy" 2>/dev/null)" ] || [ "$(ls -A "${FILES_STAGING}/client-extensions" 2>/dev/null)" ] || [ -d "${FILES_STAGING}/.ldm" ]; then
  tar -czf "${STAGING_DIR}/files.tar.gz" -C "${FILES_STAGING}" .
  files_sha=$(calculate_sha256 "${STAGING_DIR}/files.tar.gz")
  echo "${files_sha}" > "${STAGING_DIR}/files.tar.gz.sha256"
  echo "✅ Staged files archived successfully."
else
  echo "⚠️  WARNING: No staged assets found. Creating empty volume assets."
  touch "${STAGING_DIR}/files.tar.gz"
  echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" > "${STAGING_DIR}/files.tar.gz.sha256"
fi

# 4.5. Generate manifest 'meta' file with dynamic metadata
echo "📄 Generating manifest 'meta' file..."
cx_list=""
if [ -d "${FILES_STAGING}/client-extensions" ]; then
  for f in "${FILES_STAGING}/client-extensions"/*; do
    if [ -f "$f" ]; then
      cx_list="${cx_list:+${cx_list},}$(basename "$f")"
    fi
  done
fi

modules_list=""
if [ -d "${FILES_STAGING}/deploy" ]; then
  for f in "${FILES_STAGING}/deploy"/*; do
    if [ -f "$f" ]; then
      modules_list="${modules_list:+${modules_list},}$(basename "$f")"
    fi
  done
fi

active_services="liferay"
if [ -n "${DB_CONTAINER}" ]; then
  active_services="liferay,${DB_CONTAINER}"
fi

cat <<EOF > "${STAGING_DIR}/meta"
tag=${LIFERAY_TAG}
db_type=${DB_TYPE}
github_repository=${GIT_REPO}
includes_database=true
includes_volume_assets=true
includes_client_extensions=true
includes_osgi_modules=true
client_extensions=${cx_list}
osgi_modules=${modules_list}
active_services=${active_services}
EOF

rm -rf "${FILES_STAGING}"

# 5. Compress the staging directory into the final .ldmp package
echo "📦 Compressing staging directory into ${PROJECT_ID}.ldmp..."
tar -czf "${PROJECT_ID}.ldmp" -C "$STAGING_DIR" .

# 6. Generate the SHA-256 signature for the package
echo "🔒 Calculating SHA-256 signature..."
calculate_sha256 "${PROJECT_ID}.ldmp" > "${PROJECT_ID}.ldmp.sha256"

# Cleanup
rm -rf "$STAGING_DIR"

echo "--------------------------------------------------"
echo "✅ Package created successfully:"
echo "👉 ${PROJECT_ID}.ldmp"
echo "👉 ${PROJECT_ID}.ldmp.sha256"

# 7. Validate package contents
echo "🔍 Validating package payload..."
if ! (tar -xzf "${PROJECT_ID}.ldmp" -O files.tar.gz 2>/dev/null || tar -xzf "${PROJECT_ID}.ldmp" -O ./files.tar.gz 2>/dev/null) | tar -tz 2>/dev/null | grep -E -q "^\.?/?\.ldm/"; then
  echo "❌ ERROR: .ldm configuration directory is missing from the files.tar.gz payload inside the .ldmp package!"
  exit 1
fi
echo "✅ Package validation passed."
