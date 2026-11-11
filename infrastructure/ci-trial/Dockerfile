FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
 && chmod 755 /usr/sbin/policy-rc.d \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git gnupg build-essential python3 libicu72 libssl3 \
 && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /tmp/pg.asc \
 && gpg --show-keys --with-colons /tmp/pg.asc | grep -Fx 'fpr:::::::::B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8:' \
 && gpg --dearmor -o /usr/share/keyrings/pgdg.gpg /tmp/pg.asc \
 && printf 'deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main\n' > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-17 \
 && test -f /usr/share/postgresql/17/extension/pgcrypto.control \
 && rm -rf /var/lib/apt/lists/* /tmp/pg.asc
RUN case "$TARGETARCH" in \
 amd64) arch=x64; digest=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40 ;; \
 arm64) arch=arm64; digest=670adb2f268fe21dcbb58b3db0e0aa9d5b3bddfe2c651481336e561ff86de945 ;; \
 *) exit 1 ;; esac \
 && curl --fail --silent --show-error --location "https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-${arch}-2.338.2.tar.gz" -o /tmp/runner.tar.gz \
 && printf '%s  /tmp/runner.tar.gz\n' "$digest" | sha256sum --check --strict \
 && mkdir /opt/actions-runner && tar -xzf /tmp/runner.tar.gz -C /opt/actions-runner && rm /tmp/runner.tar.gz \
 && useradd --uid 10001 --create-home ci && mkdir /r && chown 10001:10001 /r
COPY policy.mjs runtime.mjs qualify.mjs launcher.mjs job-guard.mjs job-started.sh /opt/trial/
RUN chmod 555 /opt/trial/job-started.sh && chmod -R a-w /opt/trial /opt/actions-runner
ENV PATH="/usr/lib/postgresql/17/bin:${PATH}" HOME=/r/home TMPDIR=/r/t NODE_OPTIONS=--max-old-space-size=1536
USER 10001:10001
WORKDIR /r
ENTRYPOINT ["node", "/opt/trial/launcher.mjs"]
