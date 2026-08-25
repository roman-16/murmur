#!/usr/bin/env bash
set -uo pipefail

result=${PROBE_RESULT:?PROBE_RESULT is unset}

# The probe performs from inside the compositor and terminates the shell when it
# is done, so this only has to outlive it and give up if it never finishes.
for _ in $(seq 120); do
    [ -s "$result" ] && exit 0
    sleep 1
done

echo "error: the probe did not finish within two minutes" >&2
exit 1
