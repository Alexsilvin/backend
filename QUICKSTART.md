# NEON GRID Backend - Getting Started

## 5-Minute Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Database
```bash
# Copy environment template
cp .env.example .env

# Edit .env and set your PostgreSQL connection
# Example:
# DATABASE_URL="postgresql://user:password@localhost:5432/neon_grid"
```

### 3. Start Development Server
```bash
npm run dev
```

You should see:
```
✅ Backend server running on http://localhost:3001
```

### 4. Verify It Works
```bash
curl http://localhost:3001/health
```

Response:
```json
{"status":"ok","timestamp":"2026-04-26T..."}
```

## Test Your Endpoints

### Option A: Using curl

**1. Create Account**
```bash
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "username":"testuser",
    "email":"test@example.com",
    "password":"password123"
  }' \
  -c cookies.txt
```

**2. List Games**
```bash
curl http://localhost:3001/api/games
```

**3. Get Current User**
```bash
curl http://localhost:3001/api/auth/me -b cookies.txt
```

### Option B: Using Postman

1. Open Postman
2. Click **File** → **Import**
3. Select `postman_collection.json`
4. Set environment variable: `base_url = http://localhost:3001`
5. Start testing endpoints

### Option C: Using Insomnia

1. Open Insomnia
2. Click **File** → **Import** → **From File**
3. Select `postman_collection.json`
4. Start testing

## Project Structure

```
backend/
├── src/
│   ├── server.ts           # Main entry point
│   ├── routes/             # API endpoints
│   ├── middleware/         # Auth, CORS, errors
│   ├── utils/              # Database, auth, S3
│   └── types/              # TypeScript interfaces
├── package.json
├── tsconfig.json
├── .env.example            # Configuration template
├── README.md               # Full documentation
├── DEVELOPMENT.md          # Developer guide
├── Dockerfile              # Docker setup
└── postman_collection.json # API tests
```

## Core Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/auth/signup` | ❌ | Create account |
| POST | `/api/auth/login` | ❌ | Login |
| GET | `/api/auth/me` | ✅ | Get current user |
| POST | `/api/auth/logout` | ✅ | Logout |
| GET | `/api/games` | ❌ | List games |
| GET | `/api/games/:id` | ❌ | Get single game |
| POST | `/api/games/download-url` | ✅ | Get download URL |
| GET | `/api/bucket` | ✅ | Get bucket items |
| POST | `/api/bucket` | ✅ | Add to bucket |
| DELETE | `/api/bucket` | ✅ | Remove from bucket |
| GET | `/api/friends` | ✅ | Get friends |
| POST | `/api/friends` | ✅ | Add friend |
| GET | `/api/admin/overview` | 👮 | Admin dashboard |

**Legend:** ❌ = No auth, ✅ = User auth required, 👮 = Admin only

## Troubleshooting

### Port already in use
```bash
# Change port in .env
PORT=3002
npm run dev
```

### Database connection failed
```bash
# Check database URL
echo $DATABASE_URL

# Test connection
npm run test:db

# Verify PostgreSQL is running
psql --version
```

### Build errors
```bash
# Clear and rebuild
npm run clean
npm run build
npm run lint
```

## Next Steps

1. **Test all endpoints** using the Postman collection
2. **Connect frontend** by updating API base URL in frontend config
3. **Deploy to cloud** using Vercel, Railway, or Docker
4. **Add more features** following the architecture in DEVELOPMENT.md

## Documentation

- **Full Setup:** See [README.md](README.md)
- **Developer Guide:** See [DEVELOPMENT.md](DEVELOPMENT.md)
- **API Reference:** See `postman_collection.json`

## Common Issues

### CORS Errors
The backend is configured to accept requests from:
- http://localhost:3000 (frontend default)
- http://localhost:3001 (backend)

To allow other origins, update `.env`:
```env
CORS_ORIGINS="http://localhost:3000,http://yourfrontend.com"
```

### Authentication Not Working
Make sure cookies are being sent:
- Postman: Enable "Cookie Jar"
- Browser: Check cookie settings
- Insomnia: Enable "Use specified cookie jar"

### Session Expired
Default session TTL is 7 days. To change:
```env
SESSION_TTL_MS=2592000000
```

## Support

For issues or questions:
1. Check [README.md](README.md) documentation
2. Review [DEVELOPMENT.md](DEVELOPMENT.md) architecture
3. Check server logs: `npm run dev 2>&1 | tee server.log`
4. Verify database connection: `npm run test:db`

---

**Ready to go!** Start with `npm run dev` and test endpoints. 🚀
