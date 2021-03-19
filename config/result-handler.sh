#!/usr/bin/env bash
# timing
timestamp=$(date +%Y-%m-%dT%H:%M:%S.%3NZ)
request_id=$(echo "{{inputs.parameters.callback}}" | cut -d "/" -f 5)
echo "{\"application\": \"result-handler\", \"requestId\": \"$request_id\", \"level\": \"info\", \"timestamp\": \"$timestamp\", \"message\": \"timing.result-handler.start\"}"
start_time_millis=$(date +%s%3N)
EXIT_CODE=0
read -r -d '' JSON <<-'JSON_EOF'
{
  "batch_completed": "true",
  "batch_count": {{inputs.parameters.batch-count}},
  "post_batch_step_count": {{inputs.parameters.post-batch-step-count}}
JSON_EOF

if [[ "${SHOULD_POST_RESULTS}" == "true" ]]; then
  JSON="${JSON},\n"
  STAC_CATALOG_LINK="{{inputs.parameters.stac-catalog-link}}"
  STAC_CATALOG=$(cat "/tmp/metadata/${STAC_CATALOG_LINK}")
  LINKS=$(echo "${STAC_CATALOG}" | jq -r '.links[] | select(.rel=="item") | .href')
  IFS=$'\n' read -rd '' -a LINKS_ARRAY <<<"${LINKS}"
  LINK_INDEX=0
  LINK_COUNT="${#LINKS_ARRAY[@]}"
  LINKS_JSON="["
  for LINK in "${LINKS_ARRAY[@]}"; do
    LINK_INDEX=$((LINK_INDEX + 1))
    # read and parse the STAC item file
    STAC_ITEM=$(cat "/tmp/metadata/${LINK}")
    DATA_LINK=$(echo "${STAC_ITEM}" | jq -r '.assets.data')
    START=$(echo "${STAC_ITEM}" | jq -r '.properties.start_datetime')
    END=$(echo "${STAC_ITEM}" | jq -r '.properties.end_datetime')
    BBOX=$(echo "${STAC_ITEM}" | jq -r '.bbox')
    BBOX="\"bbox\": ${BBOX}"
    TEMPORAL="{\"temporal\": \"${START},${END}\",${BBOX}, "
    DATA_LINK="${DATA_LINK/{/$TEMPORAL}"
    LINKS_JSON="${LINKS_JSON}${DATA_LINK}"
    if [[ "${LINK_INDEX}" -lt "${LINK_COUNT}" ]]; then
      LINKS_JSON="${LINKS_JSON}, "
    fi
  done
  LINKS_JSON="${LINKS_JSON}]"
  JSON="${JSON}  \"items\": ${LINKS_JSON}"
fi
JSON="${JSON}\n}"
echo -e "${JSON}" >/tmp/resp.json
gzip /tmp/resp.json
curl -f -XPOST \
  -H 'Content-Type: application/json' \
  -H 'Content-Encoding: gzip' \
  --data-binary @/tmp/resp.json.gz \
  "{{inputs.parameters.callback}}/argo-response" >/dev/null

EXIT_CODE=$?
timestamp=$(date +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "{\"application\": \"result-handler\", \"requestId\": \"$request_id\", \"level\": \"info\", \"timestamp\": \"$timestamp\", \"message\": \"Progress callback completed with exit code ${EXIT_CODE}\"}"
end_time_millis=$(date +%s%3N)
duration_ms=$(($end_time_millis - $start_time_millis))
timestamp=$(date +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "{\"application\": \"result-handler\", \"requestId\": \"$request_id\", \"level\": \"info\", \"timestamp\": \"$timestamp\", \"durationMs\": $duration_ms, \"message\": \"timing.result-handler.end\"}"
exit $EXIT_CODE
