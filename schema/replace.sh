#!/bin/bash

# Check if the S3_BUCKET_URL environment variable is set
if [ -z "$S3_BUCKET_URL" ]; then
  echo "Error: S3_BUCKET_URL environment variable is not set."
  exit 1
fi

# Input and output files
INPUT_FILE="events.sql"
OUTPUT_FILE="events_modified.sql"

# Replace <S3 Bucket> with the value of S3_BUCKET_URL in the input file
sed "s|<S3 Bucket>|$S3_BUCKET_URL|g" "$INPUT_FILE" > "$OUTPUT_FILE"

echo "Replacement complete. Output saved to $OUTPUT_FILE."
