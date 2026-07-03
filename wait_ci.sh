#!/bin/bash
while true; do
  STATUS=$(curl -s "https://api.github.com/repos/peterrichards-lr/liferay-ai-commerce-accelerator/actions/runs/28609982909" | jq -r '.status')
  if [ "$STATUS" == "completed" ]; then
    CONCLUSION=$(curl -s "https://api.github.com/repos/peterrichards-lr/liferay-ai-commerce-accelerator/actions/runs/28609982909" | jq -r '.conclusion')
    echo "CI completed with conclusion: $CONCLUSION"
    break
  fi
  echo "Still waiting for CI... status is $STATUS"
  sleep 30
done
