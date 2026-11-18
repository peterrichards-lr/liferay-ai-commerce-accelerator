#!/bin/bash
#
# Sourced by the image's /usr/local/bin/configure_liferay.sh - NOT run as a
# subprocess. So this file must never use `set -e`/`set -u`/`pipefail`, call
# `exit`, or `cd` at the top level: all of those leak into the caller. A leaked
# `set -u` kills the boot on configure_liferay.sh's own unset
# LIFERAY_TOMCAT_AJP_PORT and the pod crash-loops. All work happens in a
# subshell, and this file always leaves a zero status behind.
#
# Modules are resolved from the release's modules.json manifest rather than from
# hardcoded asset URLs, so a release bump is ONE edit and the filenames stay
# owned by the publishing repo. Public release assets need no credentials.
#
# Logs go to stdout so they appear in `lcp log -s liferay`; /tmp is not
# reachable with `lcp files download`.

(
	REPO=peterrichards-lr/liferay-custom-osgi-modules

	### Pin the release and the DXP line this environment runs: ###

	RELEASE=v3.7.0
	EXPECTED_DXP_LINE=dxp-2026.q4.0

	### Modules to deploy, by their short name in modules.json: ###

	MODULES=(
		client-extension-entry
		commerce-site-type
		search-reindex
	)

	TMPDIR=${TMPDIR:-/tmp/deploy}
	DEPLOYDIR=${DEPLOYDIR:-/opt/liferay/deploy}
	BASE="https://github.com/$REPO/releases/download/$RELEASE"

	mkdir -p "$TMPDIR" || echo "[deploy.sh] WARNING: cannot create $TMPDIR"

	echo "[deploy.sh] Release $RELEASE from $REPO (expecting $EXPECTED_DXP_LINE)"

	# The manifest check further down proves a bundle was built for
	# EXPECTED_DXP_LINE. It says nothing about the line this image runs: both
	# values live in this repo and move together, so a deploy.sh bumped ahead of
	# the environment's Liferay image passes it and stages bundles that cannot
	# resolve. portal-impl.jar's manifest is the same ground truth build.gradle
	# reads for a local bundle. See #1486.
	PORTAL_IMPL_JAR=${PORTAL_IMPL_JAR:-/opt/liferay/tomcat/webapps/ROOT/WEB-INF/shielded-container-lib/portal-impl.jar}

	# "dxp-2026.q4.0" and "2026.Q4.0" describe one line in two spellings; compare
	# them as build.gradle does, with the prefix, punctuation and case removed.
	normalise_line() {
		printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^dxp-//' | tr -cd 'a-z0-9.'
	}

	portal_line=
	if [ -f "$PORTAL_IMPL_JAR" ] && command -v unzip >/dev/null 2>&1; then
		portal_line=$(unzip -p "$PORTAL_IMPL_JAR" META-INF/MANIFEST.MF 2>/dev/null |
			sed -n 's/^Liferay-Portal-Version-Display-Name: *//p' | tr -d '\r')
	fi

	# Unreadable means unknown, not wrong: carry on as before rather than take
	# the modules away from an environment that may well be on the right line.
	portal_mismatch=
	if [ -z "$portal_line" ]; then
		echo "[deploy.sh] WARNING: cannot read the portal's DXP line from $PORTAL_IMPL_JAR"
		echo "[deploy.sh]          - staging without checking it against $EXPECTED_DXP_LINE"
	elif [ "$(normalise_line "$portal_line")" != "$(normalise_line "$EXPECTED_DXP_LINE")" ]; then
		portal_mismatch=1
	else
		echo "[deploy.sh] Portal runs $portal_line"
	fi

	manifest=$TMPDIR/modules.json
	if [ -n "$portal_mismatch" ]; then
		# Refused for the same reason as a bundle built for another line below:
		# staged, it would 404 with only the boot log to say why.
		echo "[deploy.sh] ERROR: this portal runs $portal_line, but $RELEASE is pinned for"
		echo "[deploy.sh]        $EXPECTED_DXP_LINE. No modules deployed. Move the Liferay image"
		echo "[deploy.sh]        to $EXPECTED_DXP_LINE, or pin RELEASE and EXPECTED_DXP_LINE back."
	elif ! curl --fail --location --silent --show-error --output "$manifest" "$BASE/modules.json"; then
		echo "[deploy.sh] ERROR: cannot fetch modules.json for $RELEASE - no modules deployed"
	else
		# One line per bundle object, so a single record can be grepped out.
		# grep -F because module names contain '-' and a regex '.' would let a
		# typo match a different module.
		flat=$(tr -d '\n' < "$manifest" | sed 's/},/}\n/g')

		for m in "${MODULES[@]}"; do
			rec=$(printf '%s' "$flat" | grep -F "\"module\": \"$m\"")
			if [ -z "$rec" ]; then
				echo "[deploy.sh] WARNING: $m not in $RELEASE manifest - skipped"
				continue
			fi

			asset=$(printf '%s' "$rec" | sed -n 's/.*"asset": "\([^"]*\)".*/\1/p')
			sha=$(printf   '%s' "$rec" | sed -n 's/.*"sha256": "\([^"]*\)".*/\1/p')
			line=$(printf  '%s' "$rec" | sed -n 's/.*"dxpLine": "\([^"]*\)".*/\1/p')

			# Refuse rather than warn. A bundle built for another line resolves
			# nowhere and its endpoint 404s with nothing in the request log, so
			# staging it buys a silent failure instead of a loud one. Skip the
			# module and let the boot continue - taking the boot down over this
			# would be worse, and is what the leaked `set -e` used to do.
			if [ "$line" != "$EXPECTED_DXP_LINE" ]; then
				echo "[deploy.sh] ERROR: $m in $RELEASE was built against $line, but this"
				echo "[deploy.sh]        environment runs $EXPECTED_DXP_LINE. Refusing to stage it."
				echo "[deploy.sh]        Rebuild the module for $EXPECTED_DXP_LINE and bump RELEASE."
				continue
			fi

			echo "[deploy.sh] Downloading $asset"
			if ! curl --fail --location --silent --show-error --output "$TMPDIR/$asset" "$BASE/$asset"; then
				echo "[deploy.sh] WARNING: download failed, $m will be absent"
				continue
			fi

			if command -v sha256sum >/dev/null 2>&1; then
				actual=$(sha256sum "$TMPDIR/$asset" | cut -d' ' -f1)
				if [ "$actual" != "$sha" ]; then
					echo "[deploy.sh] ERROR: checksum mismatch for $asset - discarding"
					echo "[deploy.sh]        expected $sha"
					echo "[deploy.sh]        actual   $actual"
					rm -f "$TMPDIR/$asset"
					continue
				fi
				echo "[deploy.sh] Checksum verified: $asset"
			else
				echo "[deploy.sh] WARNING: sha256sum unavailable, $asset not verified"
			fi
		done

		rm -f "$manifest"

		shopt -s nullglob
		jars=("$TMPDIR"/*.jar)

		if [ ${#jars[@]} -eq 0 ]; then
			echo "[deploy.sh] WARNING: no jars to deploy"
		else
			echo "[deploy.sh] Deploying ${#jars[@]} jar(s) to $DEPLOYDIR"
			mv "${jars[@]}" "$DEPLOYDIR" || echo "[deploy.sh] WARNING: move to $DEPLOYDIR failed"
			ls -l "$DEPLOYDIR"
		fi
	fi
)

true
