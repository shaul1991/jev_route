#!/bin/sh
set -eu

profile="${1:-${OMP_PROFILE:-default}}"
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$profile" = "default" ] || [ -z "$profile" ]; then
  agent_dir="${HOME}/.omp/agent"
else
  agent_dir="${HOME}/.omp/profiles/${profile}/agent"
fi

install -d -m 700 "$agent_dir/extensions" "${HOME}/.local/bin"
install -m 600 "$repo_dir/extensions/jev-router.ts" "$agent_dir/extensions/jev-router.ts"
install -m 700 "$repo_dir/bin/omp-jev" "${HOME}/.local/bin/omp-jev"

printf '%s\n' "Installed Jev router in $agent_dir/extensions/jev-router.ts"
printf '%s\n' "Install a TypeSafe key with: printf '%s' \"\$TYPESAFE_API_KEY\" | $repo_dir/scripts/store-key.sh"
printf '%s\n' "Start OMP with: ${HOME}/.local/bin/omp-jev"
