#!/bin/bash
while true; do
  TAG=$(curl -s "https://api.github.com/repos/peterrichards-lr/liferay-docker-manager/releases/latest" | jq -r '.tag_name')
  if [ "$TAG" == "v2.11.80" ]; then
    echo "v2.11.80 is released! Triggering CI..."
    git checkout fix/ai-health-check-status
    git commit --allow-empty -m "chore: trigger CI for v2.11.80"
    git push origin fix/ai-health-check-status

    git checkout chore/remove-db-sleep-buffer
    git commit --allow-empty -m "chore: trigger CI for v2.11.80"
    git push origin chore/remove-db-sleep-buffer

    git checkout master
    break
  fi
  echo "Still waiting for v2.11.80... current tag is $TAG"
  sleep 30
done
