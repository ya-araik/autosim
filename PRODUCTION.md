# Production deployment

Production uses Nginx on ports 80/443, Let's Encrypt certificates, automatic
Certbot renewal, Next.js and MongoDB on the internal Docker network.

## Before the first launch

1. Set the A records for `auto-sim.ru` and `www.auto-sim.ru` to
   `89.23.102.228`. Wait until both names resolve to the new address.
2. Open inbound TCP ports 80 and 443 in the server firewall.
3. Stop any previous service occupying ports 80 or 443.
4. Create the production environment file:

   ```sh
   cp .env.production.example .env.production
   ```

5. Fill in the Telegram token, admin chat ID and webhook secret. The production
   domain, server IP and Let's Encrypt email are already configured.

Generate a webhook secret with:

```sh
openssl rand -hex 32
```

## First launch

```sh
./scripts/init-production.sh
```

The script builds the application, requests one certificate for `auto-sim.ru`
and `www.auto-sim.ru`, starts Nginx, enables the renewal worker and registers
the production Telegram webhook. It stops before requesting a certificate if
either domain does not resolve to `EXPECTED_PUBLIC_IPV4`.

## Subsequent updates

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Certbot checks renewal twice a day. Nginx reloads certificates every six hours,
so renewed certificates are applied without stopping the site.

MongoDB data and Let's Encrypt files are stored as bind volumes under
`./volume`, next to the cloned project. Once the initial certificate exists,
regular production startup only requires:

```sh
docker compose up -d
```

## Checks

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 nginx certbot
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew --dry-run
curl -I http://auto-sim.ru
curl -I https://auto-sim.ru
```
