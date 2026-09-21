#!/bin/sh
set +x
set -eu

service="${OMP_JEV_KEYCHAIN_SERVICE:-omp-typesafe}"
keychain="${HOME}/Library/Keychains/login.keychain-db"
key=$(cat)
if [ -z "$key" ]; then
  printf '%s\n' 'TypeSafe API key was empty' >&2
  exit 1
fi

# Quote security's interactive command syntax; reject line breaks/control characters.
security_quote() {
  case "$1" in
    *[![:print:]]*) printf '%s\n' 'Invalid control character in Keychain target' >&2; exit 1 ;;
  esac
  printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g')"
}

# Send the key as hex over stdin, never through security's process arguments.
account_arg=$(security_quote "$USER")
service_arg=$(security_quote "$service")
keychain_arg=$(security_quote "$keychain")
key_hex=$(printf '%s' "$key" | od -An -v -tx1 | tr -d ' \n')
if ! printf 'add-generic-password -U -a %s -s %s -X %s %s\n' \
  "$account_arg" "$service_arg" "$key_hex" "$keychain_arg" | security -i -q >/dev/null; then
  printf '%s\n' "Keychain storage failed: $keychain" >&2
  printf '%s\n' 'Unlock interactively: security unlock-keychain "$HOME/Library/Keychains/login.keychain-db"' >&2
  printf '%s\n' 'Enter the login Keychain password (usually your Mac login password), NOT the TypeSafe API key.' >&2
  printf '%s\n' 'Then rerun this script. For SSH use without storage, export TYPESAFE_API_KEY and run omp-jev.' >&2
  exit 1
fi
if ! stored_key=$(security find-generic-password -a "$USER" -s "$service" -w "$keychain"); then
  printf '%s\n' 'Keychain write completed, but reading the stored key failed; check Keychain access before launching.' >&2
  exit 1
fi
if [ "$stored_key" != "$key" ]; then
  printf '%s\n' 'Stored TypeSafe key did not match the supplied key' >&2
  exit 1
fi
unset key key_hex stored_key
printf '%s\n' "Stored and verified TypeSafe API key in macOS Keychain service: $service"
