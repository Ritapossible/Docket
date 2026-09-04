#!/usr/bin/env bash
# Fails if spec/THREAT-MODEL.md claims a row is covered and no test names its ID.
#
# CLAUDE.md: "A threat-model row may not be marked covered until a test references it by ID."
# This is what makes the honest rows credible — if coverage claims could drift, the
# "not covered" rows would read as decoration rather than disclosure.
set -euo pipefail

SPEC="spec/THREAT-MODEL.md"
TESTS="contracts/test"
status=0

while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/^| \(T[0-9]\+\) |.*/\1/p')
  [ -n "$id" ] || continue

  claim=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$(NF-1)); print $(NF-1)}')
  [ "$claim" = "covered" ] || continue

  # Match a test FUNCTION carrying the ID, so a mention in a doc comment cannot
  # satisfy the claim.
  if ! grep -rqE "function +test[A-Za-z0-9_]*_${id}_" "$TESTS"; then
    echo "FAIL ${id}: marked covered in ${SPEC} but no test in ${TESTS} names _${id}_"
    status=1
  else
    n=$(grep -rhcE "function +test[A-Za-z0-9_]*_${id}_" "$TESTS" | paste -sd+ | bc)
    echo "ok   ${id}: ${n} test(s)"
  fi
done < "$SPEC"

exit $status
