FROM node:18-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY proxy.js .
EXPOSE 11430
CMD ["node", "proxy.js"]
