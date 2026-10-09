# Frontends must pass their normal tests/builds before packaging this image.
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY web/dist /srv/web
COPY website/dist /srv/website
