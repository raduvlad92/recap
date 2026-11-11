#!/bin/sh
set -eu
exec timeout --signal=TERM --kill-after=2s 10s node /opt/trial/job-guard.mjs
