# NEON GRID Backend

Standalone, production-ready backend API for NEON GRID - a retro game marketplace platform.

## Quick Start

### Prerequisites

- Node.js 20+ 
- npm
- PostgreSQL database

### Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your database URL and other configuration.

3. **Start development server**
   ```bash
   npm run dev
   ```
   Server will run on `http://localhost:3001`

4. **Check health**
   ```bash
   curl http://localhost:3001/health
   ```

## Project Structure

```
backend/
├── src/
│   ├── server.ts           # Express app entry point
│   ├── types/              # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/              # Utility functions
│   │   ├── db.ts           # Database initialization & connection
│   │   ├── auth.ts         # Password hashing, token generation
│   │   └── s3.ts           # S3/Filebase storage utilities
│   ├── middleware/         # Express middleware
│   │   ├── auth.ts         # Session & role-based auth
│   │   ├── cors.ts         # CORS configuration
│   │   └── errors.ts       # Error handling
│   └── routes/             # API route handlers
│       ├── auth.ts         # Authentication endpoints
│       ├── games.ts        # Game catalog endpoints
│       ├── bucket.ts       # Bucket/cart management
│       ├── admin.ts        # Admin-only endpoints
│       └── social.ts       # Friends, notifications
├── package.json
├── tsconfig.json
├── .env.example            # Environment variable template
└── README.md               # This file
```

## API Endpoints

### Authentication

- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current session user
- `POST /api/auth/logout` - Logout

### Games

- `GET /api/games` - List all games
- `GET /api/games/:id` - Get single game
- `POST /api/games/download-url` - Get signed ROM download URL (requires auth)

### Bucket (Shopping Cart)

- `GET /api/bucket` - Get bucket items (requires auth)
- `POST /api/bucket` - Add item to bucket (requires auth)
- `DELETE /api/bucket` - Remove item from bucket (requires auth)
- `PUT /api/bucket` - Replace bucket contents (requires auth)

### Friends & Social

- `GET /api/friends` - Get friend list or search users (requires auth)
- `POST /api/friends` - Add friend (requires auth)
- `GET /api/friends/notifications` - Get notifications (requires auth)
- `PATCH /api/friends/notifications` - Mark notifications as read (requires auth)
- `DELETE /api/friends/notifications` - Delete notifications (requires auth)

### Admin

- `GET /api/admin/overview` - Admin dashboard (requires admin role)
- `POST /api/admin/rom-upload-url` - Get signed upload URL for ROM (requires admin)
- `POST /api/admin/register-rom` - Register ROM metadata (requires admin)

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/db"

# Server
NODE_ENV="development"
PORT="3001"
BACKEND_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"

# S3/Filebase Storage
S3_ENDPOINT="https://s3.filebase.com"
S3_BUCKET="your-bucket-name"
S3_ACCESS_KEY_ID="your_key"
S3_SECRET_ACCESS_KEY="your_secret"

# Admin Bootstrap
ADMIN_BOOTSTRAP_USERNAME="admin"
ADMIN_BOOTSTRAP_PASSWORD="Admin1234!"
ADMIN_BOOTSTRAP_EMAIL="admin@local.admin"

# Security
ROM_ADMIN_KEY="optional_admin_api_key"

# CORS
CORS_ENABLED="true"
CORS_ORIGINS="http://localhost:3000,http://localhost:3001"
```

## Building for Production

### Build
```bash
npm run build
```
Creates compiled JavaScript in `dist/` directory.

### Start
```bash
npm start
```

### Lint
```bash
npm run lint
```

## Deployment

### Vercel

1. Push to GitHub repository
2. Import repository in Vercel
3. Configure environment variables
4. Deploy

Vercel will automatically detect `package.json` and run build/start scripts.

### Docker

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

Build and run:
```bash
docker build -t neon-grid-backend .
docker run -p 3001:3001 --env-file .env neon-grid-backend
```

### Railway / Heroku

1. Create new project
2. Connect GitHub repository
3. Add environment variables
4. Deploy

## Database

The backend automatically initializes the PostgreSQL schema on startup. Tables created:

- `users` - User accounts
- `auth_sessions` - Session management
- `games` - Game catalog
- `bucket_items` - Shopping cart
- `friends` - Friendship connections
- `wallets` - User wallet balances
- `wallet_transactions` - Transaction history
- `orders` - Purchase orders
- `order_items` - Order line items
- `payments` - Payment records
- `game_purchases` - Game ownership tracking
- `notifications` - User notifications
- `messages` - Direct messages
- `message_groups` - Group chats
- `group_members` - Group membership
- `group_messages` - Group message history

## Testing

### Test database connection
```bash
npm run test:db
```

### Manual endpoint testing

Using curl:
```bash
# Create account
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123"}'

# List games
curl http://localhost:3001/api/games

# Check health
curl http://localhost:3001/health
```

Or use Postman/Insomnia - import API endpoints and test with saved environment variables.

## Development Notes

- Session authentication uses httpOnly cookies
- Passwords are hashed with PBKDF2 (120,000 iterations)
- S3 signed URLs are automatically generated for file operations
- CORS is configurable per environment
- All timestamps are in UTC
- Admin bootstrap user is created on first startup

## Troubleshooting

### Database connection fails
- Check `DATABASE_URL` format
- Verify PostgreSQL is running
- Ensure network connectivity to database host
- Check firewall/security group rules

### S3 upload fails
- Verify S3 credentials
- Check bucket name is correct
- Ensure IAM permissions include s3:PutObject
- Test with AWS CLI: `aws s3 ls s3://your-bucket`

### CORS errors
- Check `CORS_ORIGINS` environment variable
- Ensure frontend URL is whitelisted
- Clear browser cache

### Port already in use
- Change `PORT` environment variable
- Or kill process using the port

## License

MIT - See LICENSE file for details
