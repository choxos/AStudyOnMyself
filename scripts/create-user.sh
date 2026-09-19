#!/bin/sh
# Create the login (or reset its password with --reset) without the password
# reaching the shell history or the process list.
set -eu
cd "$(dirname "$0")/.."
printf "Username: "
read -r username
trap 'stty echo' EXIT INT TERM
stty -echo
printf "Password (12 characters or more): "
read -r password
stty echo
printf "\n"
if [ "${1:-}" = "--reset" ]; then
  printf '%s' "$password" | node scripts/cli.ts set-password "$username"
else
  printf '%s' "$password" | node scripts/cli.ts create-user "$username"
fi
