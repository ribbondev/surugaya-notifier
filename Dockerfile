FROM alpine:latest

WORKDIR /srv/app

COPY requirements.txt package.json package-lock.json ./

RUN apk add nodejs python3 py3-virtualenv \
 && apk add --virtual .build-deps shadow npm \
 && useradd --home-dir=/srv/app --system --shell /sbin/nologin --user-group app \
 && mkdir -p /srv/app/state \
 && chown app:app /srv/app/state \
 && virtualenv venv \
 && source venv/bin/activate \
 && pip install -r /srv/app/requirements.txt \
 && npm install \
 && rm -f requirements.txt package.json package-lock.json \
 && apk del .build-deps \
 && rm -rf /root/.cache /root/.local /root/.npm /var/cache/* \
 && chown -R app:app /srv/app

COPY --chown=app:app scraper index.js ./

USER app

CMD ["node", "index.js"]