FROM apify/actor-node:22
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . ./
CMD ["npm", "start", "--silent"]
