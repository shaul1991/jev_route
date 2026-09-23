#!/bin/sh
set -eu

profile="${OMP_PROFILE:-default}"
configure=0
profile_set=0
for arg in "$@"; do
  case "$arg" in
    --configure)
      configure=1
      ;;
    --help|-h)
      printf '%s\n' "Usage: $0 [profile] [--configure]"
      exit 0
      ;;
    -*)
      printf '%s\n' "Unknown option: $arg" >&2
      printf '%s\n' "Usage: $0 [profile] [--configure]" >&2
      exit 2
      ;;
    *)
      if [ "$profile_set" -eq 1 ]; then
        printf '%s\n' "Only one profile may be specified" >&2
        exit 2
      fi
      profile="$arg"
      profile_set=1
      ;;
  esac
done
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$profile" = "default" ] || [ -z "$profile" ]; then
  agent_dir="${HOME}/.omp/agent"
else
  agent_dir="${HOME}/.omp/profiles/${profile}/agent"
fi

install -d -m 700 "$agent_dir/extensions" "$agent_dir/shared" "$agent_dir/config" "${HOME}/.local/bin"
if [ ! -f "$agent_dir/config/omp.json" ]; then
  install -m 600 "$repo_dir/config/omp.json" "$agent_dir/config/omp.json"
fi
if [ "$configure" -eq 1 ]; then
  node "$repo_dir/scripts/configure-omp.mjs" "$agent_dir/config/omp.json" "$repo_dir/config/omp.json" --prompt
else
  node "$repo_dir/scripts/configure-omp.mjs" "$agent_dir/config/omp.json" "$repo_dir/config/omp.json"
fi
install -m 600 "$repo_dir/extensions/jev-router.ts" "$agent_dir/extensions/jev-router.ts"
install -m 600 "$repo_dir/shared/jev-api.mjs" "$agent_dir/shared/jev-api.mjs"
install -m 600 "$repo_dir/shared/jev-api.d.mts" "$agent_dir/shared/jev-api.d.mts"
install -m 600 "$repo_dir/shared/jev-routing.mjs" "$agent_dir/shared/jev-routing.mjs"
install -m 600 "$repo_dir/shared/jev-routing.d.mts" "$agent_dir/shared/jev-routing.d.mts"
install -m 700 "$repo_dir/bin/omp-jev" "${HOME}/.local/bin/omp-jev"

printf '%s\n' "Installed Jev router in $agent_dir/extensions/jev-router.ts"
printf '%s\n' 'For SSH without Keychain storage: export TYPESAFE_API_KEY; ~/.local/bin/omp-jev'
printf '%s\n' "Optional Keychain storage (unlock login Keychain first): printf '%s' \"\$TYPESAFE_API_KEY\" | $repo_dir/scripts/store-key.sh"
printf '%s\n' "Start OMP with: ${HOME}/.local/bin/omp-jev"
