FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
