FROM apify/actor-node:20

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --include=dev --audit=false --fund=false

COPY . ./
RUN npm run build \
    && npm prune --omit=dev

CMD ["npm", "run", "start:prod", "--silent"]
