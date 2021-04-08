#!/usr/bin/env sh
# timing
timestamp=$(date +%Y-%m-%dT%H:%M:%S.%3NZ)
request_id=$(echo "{{inputs.parameters.callback}}" | cut -d "/" -f 5)
echo "{\"application\": \"exit-handler\", \"requestId\": \"$request_id\", \"level\": \"info\", \"timestamp\": \"$timestamp\", \"message\": \"timing.exit-handler.start\"}"
start_time_millis=$(date +%s%3N)
echo '{{inputs.parameters.failures}}' >/tmp/failures
error="{{inputs.parameters.status}}"
timeout_count=$(grep -c 'Pod was active on the node longer than the specified deadline' /tmp/failures)
if [ "$timeout_count" != "0" ]; then
  error="Request%20timed%20out"
fi
if [ "{{inputs.parameters.status}}" = 'Succeeded' ]; then
  curl -XPOST "{{inputs.parameters.callback}}/response?status=successful&argo=true" >/dev/null
else
  curl -XPOST "{{inputs.parameters.callback}}/response?status=failed&argo=true&error=$error" >/dev/null
fi
end_time_millis=$(date +%s%3N)
duration_ms=$(($end_time_millis - $start_time_millis))
timestamp=$(date +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "{\"application\": \"exit-handler\", \"requestId\": \"$request_id\", \"level\": \"info\", \"timestamp\": \"$timestamp\", \"durationMs\": $duration_ms, \"message\": \"timing.exit-handler.end\"}"
