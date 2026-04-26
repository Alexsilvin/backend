# NEON GRID Backend - Development Guide

## Architecture

### Layered Design

```
Request
  ↓
Middleware (CORS, Auth, Error Handling)
  ↓
Routes (Endpoint Handlers)
  ↓
Utils (Database, Auth, Storage)
  ↓
Database (PostgreSQL)
```

### Directory Breakdown

- **src/server.ts** - Express app initialization, middleware setup, route mounting
- **src/types/** - Centralized TypeScript interfaces (UserRow, GameRow, etc.)
- **src/utils/** - Reusable functions:
  - `db.ts` - Database pool, schema initialization, seeding
  - `auth.ts` - Password hashing, session tokens, crypto functions
  - `s3.ts` - S3 client, signed URLs, file operations
- **src/middleware/** - Express middleware:
  - `auth.ts` - Session validation, role checks
  - `cors.ts` - CORS configuration
  - `errors.ts` - Global error handler
- **src/routes/** - Feature-based endpoint handlers:
  - `auth.ts` - Signup, login, logout, session
  - `games.ts` - Game catalog, downloads
  - `bucket.ts` - Cart/bucket management
  - `admin.ts` - Admin panel, ROM management
  - `social.ts` - Friends, notifications

## Key Design Patterns

### 1. Middleware-First Approach
All routes use middleware for authentication and authorization:
```typescript
router.get('/', requireAuth, async (req, res) => { ... })
router.get('/', requireAdmin, async (req, res) => { ... })
```

### 2. Centralized Error Handling
Express error handler catches exceptions:
```typescript
app.use(errorHandler);
```

### 3. Session-Based Authentication
Uses httpOnly cookies with hash verification:
- Token created and stored in auth_sessions table
- Cookie sent to client (httpOnly, SameSite=Lax)
- Each request validates token and loads user

### 4. Type Safety
All responses use TypeScript interfaces defined in `types/index.ts`:
- Request/response contracts are explicit
- IDE autocomplete support
- Type errors caught at compile time

## Adding New Endpoints

### Step 1: Define Types
Add to `src/types/index.ts`:
```typescript
export interface MyResource {
  id: string;
  name: string;
}
```

### Step 2: Create Route Handler
Create `src/routes/myfeature.ts`:
```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  // Handler
});

export default router;
```

### Step 3: Mount Route
In `src/server.ts`:
```typescript
import myfeatureRoutes from './routes/myfeature';
app.use('/api/myfeature', myfeatureRoutes);
```

## Database Migrations

Migrations are handled via runtime schema setup in `src/utils/db.ts`:

```typescript
export async function initializeDatabase(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ...
    );
  `);
}
```

**Note:** This approach avoids migration files but still supports versioning through conditional `ALTER TABLE` statements.

## Testing Locally

### 1. Start Backend
```bash
npm run dev
```

### 2. Test with curl
```bash
# Signup
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"pass123"}' \
  -c cookies.txt

# Login (saves session cookie)
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"pass123"}' \
  -c cookies.txt

# Get current user (uses session cookie)
curl http://localhost:3001/api/auth/me -b cookies.txt
```

### 3. Use Postman
- Import endpoints from `src/routes/**/*.ts`
- Set environment variables for session cookies
- Test with database content

## Performance Considerations

1. **Database Connection Pooling**
   - Pool size: 20 connections
   - Idle timeout: 30 seconds

2. **Query Optimization**
   - Use indexed columns (user_id, game_id, created_at)
   - Batch operations when possible
   - Limit query results

3. **S3 Signed URLs**
   - Generated on-demand, cached by browser
   - Default expiration: 60-300 seconds
   - Prevents hotlinking

4. **Session Management**
   - Default TTL: 7 days
   - Stored in auth_sessions table
   - Cleaned up automatically on logout

## Security Best Practices

1. **Passwords**: PBKDF2 with 120,000 iterations + salt
2. **Sessions**: Secure httpOnly cookies with SameSite=Lax
3. **Admin Key**: Environment variable only, never in code
4. **S3 Credentials**: Environment variables, never committed
5. **Input Validation**: All user inputs sanitized
6. **CORS**: Configurable and restrictive by default
7. **SQL Injection**: Parameterized queries via pg library

## Common Tasks

### Create Admin User
Admin is bootstrapped automatically on first startup using:
- `ADMIN_BOOTSTRAP_USERNAME`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `ADMIN_BOOTSTRAP_EMAIL`

### Upload ROM File
1. Call `POST /api/admin/rom-upload-url` to get signed PUT URL
2. Upload binary to S3 using signed URL
3. Call `POST /api/admin/register-rom` to save metadata

### Generate Download URL
1. User calls `POST /api/games/download-url`
2. Backend validates ownership (if configured)
3. Backend generates signed GET URL
4. Frontend receives URL and downloads file

### Add New User Role
1. Add role to `UserRole` type in `types/index.ts`
2. Add check constraint in database schema
3. Create middleware: `requireRole(role)`
4. Use middleware on routes

## Debugging

Enable debug logging:
```bash
DEBUG=neon-grid:* npm run dev
```

Check database:
```bash
psql $DATABASE_URL
SELECT * FROM users;
SELECT * FROM games;
```

Monitor requests:
```bash
npm run dev 2>&1 | tee server.log
```

## Related Files

- Frontend code: `../web site/src/`
- Shared types: `../web site/api/`
- Database schemas: `../web site/doc/sql/`
- API documentation: `../web site/doc/API_DOCUMENTATION.md`
