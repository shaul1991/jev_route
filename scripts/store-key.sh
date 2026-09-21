#!/bin/sh
set -eu

service="${OMP_JEV_KEYCHAIN_SERVICE:-omp-typesafe}"
key=$(cat)
if [ -z "$key" ]; then
  printf '%s\n' 'TypeSafe API key was empty' >&2
  exit 1
fi

security add-generic-password -U -a "$USER" -s "$service" -w "$key" >/dev/null
printf '%s\n' "Stored TypeSafe API key in macOS Keychain service: $service"
