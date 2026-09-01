# Deploying

Revel runs on **astral** (`ssh astral`, `192.9.168.47`, Oracle, aarch64, 2
cores, 11GB). Not on vega, which runs Logfare and has users — see the note at
the end.

Everything lives under `/mnt/blockvol/revel`:

```
app/       docker-compose.yml, .env (0600, not in git)
postgres/  the database, owned by uid 999
blobs/     encrypted attachments, owned by the container's uid
secrets/   host-key.json, 0600
web/       the built SPA, served by nginx
```

## The disk, which is the thing that will bite

`/` is 45GB and sits around **95% full**. Docker's data-root is on it. So:

- **Never use a named volume.** It lands on the full disk. Every path that
  stores anything in `docker-compose.yml` is a bind mount to `/mnt/blockvol`.
- **Never build the image on astral.** The build cache goes to `/` too. Build
  on ladybug — it is arm64, so the artifact is identical — and ship it:

  ```
  docker build -f deploy/Dockerfile -t revel-host:latest .
  docker save revel-host:latest | gzip -1 | ssh astral 'gunzip | docker load'
  ```

- Check `df -h /` before and after anything that pulls an image.

## Bringing it up

```
cd /mnt/blockvol/revel/app
docker compose up -d
docker compose ps          # both healthy
docker compose logs host   # migrations, shard, host key, "idp: serving"
```

The Host binds `127.0.0.1:8090` and nothing else. nginx is the only thing that
can reach it; binding `0.0.0.0` on a box with a public IP publishes it whatever
the firewall is supposed to say.

## The host key

Generated **on astral**, inside the image, so it never crosses a network:

```
docker run --rm --user root -v /mnt/blockvol/revel/secrets:/data/secrets \
  -e REVEL_HOST_KEY_FILE=/data/secrets/host-key.json \
  revel-host:latest bun run apps/server/src/init.ts
sudo chown 100:100 /mnt/blockvol/revel/secrets/host-key.json
sudo chmod 600 /mnt/blockvol/revel/secrets/host-key.json
```

**Back it up, and understand that neither key in it can be regenerated.** The
signature key is published in the group context of every group this Host is an
external sender for; the OPAQUE setup is what every password was registered
against, so replacing it locks everybody out of their account.

## DNS

```
revel.chat.       A     192.9.168.47
www.revel.chat.   A     192.9.168.47
```

One A record does it: `REVEL_HOST` and `REVEL_IDP` are the same host, and the
client resolves the Host from `location.origin` — there is no build-time URL to
get wrong. Oracle's security list already allows 80/443, because nginx serves
other domains from this box.

## TLS

```
sudo certbot certonly --webroot -w /var/www/certbot -d revel.chat -d www.revel.chat
sudo cp deploy/nginx/revel.chat.conf /etc/nginx/sites-available/revel.chat
sudo nginx -t && sudo systemctl reload nginx
```

astral runs **nginx 1.18**, which predates the standalone `http2 on;`
directive (1.25.1). It is a `listen` parameter here — `listen 443 ssl http2`.
Getting that wrong fails `nginx -t`, which is the good outcome: a failed
reload keeps the running config, so the other seven sites on this box stay up
while you fix it.

`/.well-known/acme-challenge/` is carved out **ahead of** the API proxy in that
config, and has to stay that way: `security.txt` is served by the Host, so
proxying all of `/.well-known` would break every renewal from the first one on.

## Shipping a change

```
# on ladybug
pnpm typecheck && pnpm test
docker build -f deploy/Dockerfile -t revel-host:latest .
docker save revel-host:latest | gzip -1 | ssh astral 'gunzip | docker load'
(cd apps/web && npx vite build)
rsync -az --delete apps/web/build/ astral:/mnt/blockvol/revel/web/

# on astral
cd /mnt/blockvol/revel/app && docker compose up -d
```

`web/` stays **owned by the deploying user and world-readable**. It is
tempting to `chown -R www-data` it, and that breaks every later `rsync` with a
permission denied — nginx needs to *read* those files, not own them. `chmod -R
a+rX` is the whole requirement.

Migrations run at boot and are checksummed, so a container that starts is a
container whose schema matched. **Rolling back the image does not roll back the
schema** — an older Host against a newer database will fail its checksum and
refuse to start, which is the correct outcome and not a bug to work around.

## What changing the schema costs

Two schemas, and the difference matters more than anything else here.

**Postgres is cheap.** Versioned migrations, checksummed, applied at boot. The
server's data is not encrypted — it is an opaque event log plus metadata — so
columns can be added, backfilled and rewritten freely. Nothing about running
this constrains it.

**The encrypted event schema is permanent.** `docs/29` §1: encrypted history
can never be re-encrypted. Once real messages exist, those bytes are fixed in
that shape forever. Three things make that survivable rather than terrifying:

1. `v: z.literal(1)` on every payload is *checked*. A future `v: 2` fails the
   parse, falls to `{ known: false, raw }`, and is preserved and rendered as a
   fallback rather than dropped.
2. An unknown event **type** does the same (`docs/29` §1 rule 3).
3. `FaceCard` versus `FaceRef` is the worked example: the note travels on the
   roster because putting it on `FaceRef` would have put it on every message
   anyone ever sends, forever.

The gap, stated rather than hidden: zod strips unknown **fields** on a known
type. A field added to `m.message` later is dropped by an older client's parse.
Not data loss — the ciphertext on the server still has it, so a newer client
recovers it on resync — but an old client will not round-trip it.

## DNS and Cloudflare

Both records are **DNS-only (grey cloud)**, and the apex must stay that way.

Proxying would put Cloudflare in front of the *client JavaScript*, and whoever
serves the JS in a browser E2EE app can replace it with a build that
exfiltrates keys. No amount of client-side crypto survives that. It would also
hand a second party the metadata `docs/03` §7 is careful about — handles, the
OPAQUE exchange, room ids, who talks to whom — and drop idle WebSockets at
around 100s against nginx's 3600s.

A Cloudflare redirect rule on `www` does nothing while `www` is grey: those
rules only run on proxied traffic. nginx does the redirect instead, which is
why `www` is in the certificate. If `www` is ever proxied, take it *out* of
certbot — a catch-all redirect rule swallows the ACME challenge and renewal
fails.

## Why not vega

vega runs Logfare, which has users. Revel is pre-alpha and gets redeployed
constantly — migrations, restarts, a Postgres still being tuned. A shared box
means any of that can take Logfare down, and a shared Postgres means one
careless `DATABASE_URL` can take its data. That is not hypothetical: the
conformance suite truncated the *development* database until it was moved to
its own schema.
