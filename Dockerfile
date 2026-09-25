FROM node:22-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY . .
RUN for f in src/*.js server.mjs; do node --check "$f"; done && git rev-parse HEAD > build-sha.txt

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/index.html /app/robots.txt /app/server.mjs /app/build-sha.txt ./
COPY --from=build /app/src ./src
ENV PORT=8080 NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
