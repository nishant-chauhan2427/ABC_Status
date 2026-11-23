# ABC Platform Status — the Upptime-built status page, served like the ABC frontend
# (node:20-alpine + a pinned `serve`, port 4173).
#
# Build context: the repo root with the built site in ./site — the gh-pages branch,
# which Upptime's "Static Site CI" writes. The Docker Image CI workflow checks it out
# there; locally: git archive origin/gh-pages | tar -x -C site
#
# Upptime builds the site for one base path (status-website.baseUrl in .upptimerc.yml,
# today /ABC_Status), so it is served under that path and "/" redirects to it. When
# the site moves to its own domain (cname set, baseUrl removed), build with
# --build-arg BASE_PATH= to serve it from the root.
FROM node:20-alpine

WORKDIR /app

# Pinned, as in the frontend: an unpinned `serve` changed behaviour under us there.
RUN npm install -g serve@14.2.4

ARG BASE_PATH=/ABC_Status

COPY site/ ./dist${BASE_PATH}/

# Routing (redirect to the base path, Upptime's app routes): see serve-config.sh.
COPY docker/serve-config.sh /usr/local/bin/serve-config.sh
RUN sh /usr/local/bin/serve-config.sh "$BASE_PATH" > dist/serve.json && cat dist/serve.json

ENV PORT=4173
EXPOSE 4173

# Bind every interface and never switch to a random port (see the frontend's Dockerfile).
CMD ["sh", "-c", "serve dist -l tcp://0.0.0.0:${PORT} --no-port-switching"]
