# Dockerfile
FROM node:20

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "app.js"]
