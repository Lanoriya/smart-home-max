#!/bin/sh
# Downloads a file from a Russian site. Many of them do not answer a server
# abroad or reply 403, so after a failed direct attempt the download is
# repeated through the tunnel: an HTTP proxy that a computer in Russia opens on
# this server (see README, «Туннель для российских сайтов»).
#
#   scripts/fetch-ru.sh <url> <file>
#   TUNNEL_PROXY=http://127.0.0.1:1080 (default)
set -u

url="$1"
out="$2"
proxy="${TUNNEL_PROXY:-http://127.0.0.1:1080}"
agent='Mozilla/5.0 (Domoved registry update)'

if curl -fsSL --connect-timeout 15 --max-time 900 -A "$agent" -o "$out" "$url"; then
  echo "direct: $url"
  exit 0
fi

port="${proxy##*:}"
if ! ss -ltn 2>/dev/null | grep -q "127.0.0.1:${port%/}"; then
  echo "failed: $url (no direct access, and the tunnel is not running)" >&2
  exit 1
fi

if curl -fsSL --connect-timeout 30 --max-time 1800 -A "$agent" --proxy "$proxy" -o "$out" "$url"; then
  echo "tunnel: $url"
  exit 0
fi
echo "failed: $url (directly and through the tunnel)" >&2
exit 1
