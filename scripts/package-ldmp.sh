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

# 2. Write the manifest meta file
echo "📄 Generating manifest 'meta' file..."
cat <<EOF > "${STAGING_DIR}/meta"
tag=${LIFERAY_TAG}
db_type=${DB_TYPE}
github_repository=${GIT_REPO}
includes_database=true
includes_volume_assets=true
includes_client_extensions=true
EOF

# 3. Dump your Database state from the running postgres container
echo "💾 Dumping PostgreSQL database 'aica-db' state..."
if docker ps | grep -q "aica-db"; then
  docker exec aica-db pg_dump -U lportal lportal > "${STAGING_DIR}/database.sql"
  echo "✅ Database dump completed successfully."
else
  echo "⚠️  WARNING: Running 'aica-db' container not found. Including a blank SQL file."
  touch "${STAGING_DIR}/database.sql"
fi

# 4. Package directory assets (document_library)
echo "📂 Archiving volume assets (document_library)..."
if [ -d "bundles/data/document_library" ]; then
  tar -czf "${STAGING_DIR}/files.tar.gz" -C bundles/data document_library
  files_sha=$(calculate_sha256 "${STAGING_DIR}/files.tar.gz")
  echo "${files_sha}" > "${STAGING_DIR}/files.tar.gz.sha256"
  echo "✅ Volume assets archived successfully."
else
  echo "⚠️  WARNING: 'bundles/data/document_library' not found. Creating empty volume assets."
  touch "${STAGING_DIR}/files.tar.gz"
  echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" > "${STAGING_DIR}/files.tar.gz.sha256"
fi

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
