# Clean-room install smoke for @pesuto/demotale.
# Not a product image — only used by scripts/docker-smoke.sh.
FROM node:22-bookworm

# System ffmpeg, as on GitHub-hosted Ubuntu. The pack no longer ships ffmpeg-static.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /smoke

COPY pack/*.tgz /pack/
COPY examples/basic /opt/examples/basic
COPY scripts/assert-doctor-smoke.mjs /opt/assert-doctor-smoke.mjs

# 1) Empty project: one-package install, doctor, init --agent
RUN mkdir -p /smoke/app \
  && cd /smoke/app \
  && npm init -y \
  && npm i -D /pack/*.tgz \
  && npx playwright install-deps chromium \
  && (npx demotale doctor --json > /tmp/doctor.json || true) \
  && node /opt/assert-doctor-smoke.mjs /tmp/doctor.json \
  && npx demotale init --agent \
  && test -f AGENTS.md \
  && npx demotale agent-guide | head -n 5

# 2) examples/basic: same tarball, prove the browser actually launches via check
RUN mkdir -p /smoke/example \
  && cp -a /opt/examples/basic/. /smoke/example/ \
  && cd /smoke/example \
  && npm init -y \
  && npm i -D /pack/*.tgz \
  && npx demotale check

CMD ["npx", "demotale", "doctor"]
