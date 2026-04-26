import cors from 'cors';

/**
 * Get CORS options based on environment
 */
export function getCorsOptions(): cors.CorsOptions {
  const corsEnabled = process.env.CORS_ENABLED !== 'false';
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  if (!corsEnabled) {
    return { origin: false };
  }

  return {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  };
}
