FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy all source files
COPY . .

# Build the TypeScript project
RUN npm run build

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
