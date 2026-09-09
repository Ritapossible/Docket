## What and why

<!-- The diff says what changed. Say why it needed to. -->

## Verification

<!-- What you ran, and what it printed. "Tests pass" is not verification. -->

- [ ] `make test` and `make fmt-check`
- [ ] `npm run lint` and `npm run test:dcs1`
- [ ] `bash script/check-threat-coverage.sh`
- [ ] `make console-e2e` (if the console or the indexer changed)

## Invariants

- [ ] No policy violation can revert (I2)
- [ ] No policy loosening bypasses the timelock (I3)
- [ ] No new global mutable state on the hot path (I4)
- [ ] Nothing published became irreproducible from chain events alone (I5)
- [ ] No model judgement entered a decision path (I6)

## Claims

- [ ] Every performance claim cites `bench/RESULTS.md`
- [ ] Every threat-model row marked `covered` is named by a test
