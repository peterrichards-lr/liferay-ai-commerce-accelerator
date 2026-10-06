# Pinned by digest, not :latest.
#
# The same commit built on 2 October and failed on 3, 4 and 5 October with
# nothing changed in this repository (#1235). That is only possible when an
# input floats, and this was one of two - the other being that the build has
# no lockfile, which is tracked on the same issue.
#
# This digest is the image that was current for BOTH the working build and the
# failures, so pinning it is for reproducibility, not a fix. What it buys is
# that a base-image change arrives as a deliberate commit with a CI run behind
# it, rather than silently between two nightlies.
#
# liferay/node-runner:latest as of 2026-10-01T00:07:04Z. Ubuntu `questing`
# (25.10) underneath - a short-support release, which is a second reason not
# to track the tag.
FROM liferay/node-runner@sha256:f4c1ef4c5affd0ae0c5e3303f147bf220dbb0faf3cdafd06f7469898926d62f6

ENV NODE_VERSION=v22
ENV PATH="/usr/local/node/${NODE_VERSION}/bin:${PATH}"

USER root
RUN apt-get update && apt-get install -y git build-essential python3 && npm install -g yarn && rm -rf /var/lib/apt/lists/*

USER liferay
COPY --chown=liferay:liferay . /opt/liferay

RUN yarn install
