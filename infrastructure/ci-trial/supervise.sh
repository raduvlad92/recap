#!/bin/bash
# Run on the Linux Docker host, outside the runner. Never mount Docker access into the job.
set -euo pipefail
test "$(id -u)" = 0
test "$#" = 2
private=$(realpath -- "$1")
image=$2
package=$(cd -- "$(dirname -- "$0")" && pwd)
operation=$(python3 - "$private" "$image" <<'PY'
import datetime,json,pathlib,re,sys
p=pathlib.Path(sys.argv[1]);i=json.loads((p/'intent.json').read_text())
assert re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',i['operationId'])
assert p==pathlib.Path('/var/lib/therecap-ci-trial')/i['operationId']
assert i['location']=='hostinger' and i['repository']=='raduvlad92/recap'
assert re.fullmatch(r'(?:sha256:|[a-z0-9][a-z0-9._:/-]*@sha256:)[a-f0-9]{64}',sys.argv[2])
issued=datetime.datetime.fromisoformat(i['issuedAt'].replace('Z','+00:00'))
expiry=datetime.datetime.fromisoformat(i['expiresAt'].replace('Z','+00:00'))
assert issued<=datetime.datetime.now(datetime.timezone.utc)<expiry
assert (expiry-issued).total_seconds()==2700
print(i['operationId'])
PY
)
test -e /sys/fs/cgroup/cgroup.controllers
test "$(getconf _NPROCESSORS_ONLN)" -ge 2
test "$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)" -ge 6291456
test "$(df --output=avail -B1 "$private" | tail -n 1)" -ge 21474836480
docker image inspect "$image" > "$private/image-before.json"
python3 - "$private" <<'PY' > "$private/host-capacity-before.json"
import datetime,json,os,pathlib,shutil,sys
memory={line.split(':')[0]:int(line.split()[1])*1024 for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if ':' in line and line.split()[1].isdigit()}
disk=shutil.disk_usage(sys.argv[1])
print(json.dumps({'sampledAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cpus':os.cpu_count(),
 'availableMemoryBytes':memory['MemAvailable'],'freeDiskBytes':disk.free,'nativeProviderIdentityStillRequired':True}))
PY
docker ps -a --no-trunc --format json > "$private/containers-before.jsonl"
export CI_TRIAL_OPERATION_ID=$operation CI_TRIAL_IMAGE=$image
export CI_TRIAL_INTENT_FILE=$private/intent.json CI_TRIAL_JIT_FILE=$private/runner-jit
export CI_TRIAL_SCRATCH_DIR=$private/scratch
project=therecap-ci-trial-$operation
test -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")"
test -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")"
test ! -e "$private/scratch.ext4"
test ! -e "$CI_TRIAL_SCRATCH_DIR"
test ! -e "$private/supervisor-started"
umask 077
: > "$private/supervisor-started"
mkdir "$CI_TRIAL_SCRATCH_DIR"
mounted=false
cleanup() {
 local original=$?
 trap - EXIT HUP INT TERM
 set +e
 timeout 30s docker compose -p "$project" -f "$package/compose.yaml" kill runner
 timeout 15s docker compose -p "$project" -f "$package/compose.yaml" logs --no-color runner > "$private/runner.log" 2>&1
 timeout 30s docker compose -p "$project" -f "$package/compose.yaml" down --volumes
 local removed=$?
 if [ "$removed" = 0 ] && [ "$mounted" = true ]; then
  umount -- "$CI_TRIAL_SCRATCH_DIR"
  if ! mountpoint -q "$CI_TRIAL_SCRATCH_DIR"; then
   if rm -f -- "$private/scratch.ext4" "$private/runner-jit" && rmdir -- "$CI_TRIAL_SCRATCH_DIR"; then
    printf '{"containerAndScratchRemoved":true,"githubRegistrationReadbackRequired":true}\n' > "$private/host-cleanup.json"
   else original=1; fi
  else original=1; fi
 elif [ "$mounted" = true ]; then original=1
 else
  rm -f -- "$private/scratch.ext4" "$private/runner-jit"
  rmdir -- "$CI_TRIAL_SCRATCH_DIR"
 fi
 exit "$original"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
# Allocate the entire budget before launch; the runner cannot fill the host past this file.
fallocate -l 8589934592 "$private/scratch.ext4"
mkfs.ext4 -q -F "$private/scratch.ext4"
mount -o loop,nodev,nosuid "$private/scratch.ext4" "$CI_TRIAL_SCRATCH_DIR"
mounted=true
chown 10001:10001 "$CI_TRIAL_SCRATCH_DIR" "$CI_TRIAL_INTENT_FILE" "$CI_TRIAL_JIT_FILE"
chmod 700 "$CI_TRIAL_SCRATCH_DIR"
chmod 400 "$CI_TRIAL_INTENT_FILE" "$CI_TRIAL_JIT_FILE"
findmnt --json --target "$CI_TRIAL_SCRATCH_DIR" > "$private/scratch-mount.json"
df -B1 "$CI_TRIAL_SCRATCH_DIR" > "$private/scratch-capacity.txt"
docker compose -p "$project" -f "$package/compose.yaml" config --format json > "$private/deployment.json"
seconds=$(python3 - "$private/intent.json" <<'PY'
import datetime,json,sys
i=json.load(open(sys.argv[1]));end=datetime.datetime.fromisoformat(i['expiresAt'].replace('Z','+00:00'))
left=int((end-datetime.datetime.now(datetime.timezone.utc)).total_seconds())
assert left>0
print(min(1800,left))
PY
)
# This deadline is outside the job's PID namespace/UID. The in-container watcher is supplementary.
timeout --signal=TERM --kill-after=10s "${seconds}s" \
 docker compose -p "$project" -f "$package/compose.yaml" up --abort-on-container-exit --exit-code-from runner
