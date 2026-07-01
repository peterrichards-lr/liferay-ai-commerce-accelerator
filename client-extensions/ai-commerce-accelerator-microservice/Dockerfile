FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN yarn install --frozen-lockfile --production
COPY . .
ENV PORT=3001
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.cjs"]
