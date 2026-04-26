import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Middleware
import { getCorsOptions } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

// Database
import { initializeDatabase, testConnection } from './utils/db.js';

// Routes
import authRoutes from './routes/auth.js';
import gamesRoutes from './routes/games.js';
import bucketRoutes from './routes/bucket.js';
import notificationsRoutes from './routes/notifications.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import socialRoutes from './routes/social.js';
import messagesRoutes from './routes/messages.js';
import groupsRoutes from './routes/groups.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const app: Express = express();

/**
 * Initialize middleware
 */
function initializeMiddleware(app: Express): void {
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(cors(getCorsOptions()));

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API status endpoint
  app.get('/api/status', (_req, res) => {
    res.json({
      status: 'online',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    });
  });
}

/**
 * Initialize routes
 */
function initializeRoutes(app: Express): void {
  app.use('/api/auth', authRoutes);
  app.use('/api/games', gamesRoutes);
  app.use('/api/bucket', bucketRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/friends', socialRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/groups', groupsRoutes);

  // Catch-all for undefined routes
  app.use(notFoundHandler);
}

/**
 * Start server
 */
async function startServer(): Promise<void> {
  try {
    console.log('🚀 Initializing NEON GRID Backend...\n');

    // Test database connection first
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.warn('⚠️  Database connection failed. Some features may not work.');
    }

    // Initialize database schema
    await initializeDatabase();

    // Initialize middleware
    initializeMiddleware(app);

    // Initialize routes
    initializeRoutes(app);

    // Error handling (must be last)
    app.use(errorHandler);

    // Start listening
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n✅ Backend server running on http://localhost:${PORT}`);
      console.log(`📡 Frontend should point to http://localhost:${PORT}/api`);
      console.log(`🔗 CORS enabled for: ${process.env.CORS_ORIGINS || 'http://localhost:3000'}\n`);

      console.log('📚 Available endpoints:');
      console.log('   Auth:  POST /api/auth/signup, /api/auth/login, /api/auth/logout, GET /api/auth/me');
      console.log('   Games: GET /api/games');
      console.log('   Bucket: GET/POST/PUT/DELETE /api/bucket');
      console.log('   Wallet: GET /api/wallet, GET /api/wallet/purchases, POST /api/wallet/purchase');
      console.log('   Friends: GET/POST /api/friends');
      console.log('   Messages: GET/POST/PATCH /api/messages');
      console.log('   Groups: GET/POST /api/groups, GET/POST /api/groups/:groupId/messages');
      console.log('   Admin: GET /api/admin/overview, POST /api/admin/rom-upload-url, /api/admin/register-rom');
      console.log('   Social: GET /api/friends/notifications, PATCH/DELETE /api/friends/notifications\n');
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n📛 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n📛 Shutting down gracefully...');
  process.exit(0);
});

startServer();
