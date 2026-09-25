#!/usr/bin/env bash
# Fails if spec/THREAT-MODEL.md claims a row is covered and no test names its ID.
#
# CLAUDE.md: "A threat-model row may not be marked covered until a test references it by ID."
# This is what makes the honest rows credible - if coverage claims could drift, the
# "not covered" rows would read as decoration rather than disclosure.
set -euo pipefail

SPEC="spec/THREAT-MODEL.md"
# Solidity tests and indexer tests both count. Not every threat is a contract-level threat -
# T13 is "the indexer publishes a false score", which no Solidity test can possibly answer -
# and a gate that only looked at contracts/test would force either a dishonest "partial" or a
# meaningless Solidity test written to satisfy the grep.
TESTS="contracts/test indexer/test"
status=0

while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/^| \(T[0-9]\+\) |.*/\1/p')
  [ -n "$id" ] || continue

  claim=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$(NF-1)); print $(NF-1)}')
  [ "$claim" = "covered" ] || continue

  # Match a test FUNCTION carrying the ID, so a mention in a doc comment cannot
  # satisfy the claim.
  # Solidity: `function testFoo_T13_()`. TypeScript: `test("_T13_ ...")`.
  # Both anchor on the ID appearing in a test's own name, so a mention in a doc comment
  # still cannot satisfy the claim.
  pattern="(function +test[A-Za-z0-9_]*_${id}_|test\\(\"_${id}_)"

  # shellcheck disable=SC2086
  if ! grep -rqE "$pattern" $TESTS; then
    echo "FAIL ${id}: marked covered in ${SPEC} but no test in ${TESTS} names _${id}_"
    status=1
  else
    # shellcheck disable=SC2086
    n=$(grep -rhoE "$pattern" $TESTS | wc -l | tr -d ' ')
    echo "ok   ${id}: ${n} test(s)"
  fi
done < "$SPEC"

exit $status
