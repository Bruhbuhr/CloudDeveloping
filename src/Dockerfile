FROM node:20-slim AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

FROM node:20-slim
WORKDIR /usr/src/app
COPY --from=build /usr/src/app /usr/src/app
COPY . .

EXPOSE 3000
CMD ["node", "app.js"]
