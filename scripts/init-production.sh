#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-.env.production}

cd "$ROOT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Production env file not found: $ENV_FILE"
  echo "Create it from .env.production.example and fill in all required values."
  exit 1
fi

if grep -Eq '=(PASTE_|CHANGE_ME|admin@example\.com)' "$ENV_FILE"; then
  echo "Production env still contains placeholder values: $ENV_FILE"
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"
}

compose config --quiet
mkdir -p volume/mongo volume/letsencrypt volume/certbot-webroot

expected_ip=$(sed -n 's/^EXPECTED_PUBLIC_IPV4=//p' "$ENV_FILE" | tail -n 1 | tr -d '[:space:]')

if [ -n "$expected_ip" ]; then
  for domain in auto-sim.ru www.auto-sim.ru; do
    if command -v getent >/dev/null 2>&1; then
      resolved_ips=$(getent ahostsv4 "$domain" | awk '{ print $1 }' | sort -u)
    elif command -v dig >/dev/null 2>&1; then
      resolved_ips=$(dig +short A "$domain" | sort -u)
    elif command -v host >/dev/null 2>&1; then
      resolved_ips=$(host -t A "$domain" | awk '/has address/ { print $4 }' | sort -u)
    else
      echo "Install getent, dig or host to verify production DNS."
      exit 1
    fi

    if ! printf '%s\n' "$resolved_ips" | grep -Fxq "$expected_ip"; then
      echo "$domain does not resolve to the expected production IP $expected_ip."
      echo "Current IPv4 addresses: ${resolved_ips:-none}"
      exit 1
    fi
  done
fi

compose up -d --build mongo autosim

if compose run --rm --no-deps --entrypoint sh certbot -c \
  'test -s /etc/letsencrypt/live/auto-sim.ru/fullchain.pem && test -s /etc/letsencrypt/live/auto-sim.ru/privkey.pem'; then
  echo "Existing Let's Encrypt certificate found."
else
  echo "Requesting the initial Let's Encrypt certificate..."
  compose --profile init run --rm --service-ports certbot-init
fi

compose up -d nginx certbot

attempt=0
until compose exec -T nginx wget -qO- http://127.0.0.1/nginx-health >/dev/null 2>&1; do
  attempt=$((attempt + 1))

  if [ "$attempt" -ge 30 ]; then
    echo "Nginx did not become healthy in time."
    compose logs --tail=100 nginx
    exit 1
  fi

  sleep 2
done

compose up -d telegram-webhook
compose ps

echo "Production is ready at https://auto-sim.ru"
