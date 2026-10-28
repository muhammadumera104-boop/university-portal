import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { api } from './routes/api.js';
import { auth as authRoutes } from './routes/auth.js';

// Postgres / PostgREST error codes that represent client mistakes rather than server faults.
const databaseErrors = {
  PGRST116: [404, 'The requested record was not found.'],
  '42501': [403, 'You do not have permission for this action.'],
  '23505': [409, 'This record already exists.'],
  '23503': [422, 'A related record does not exist.'],
  '23514': [422, 'Some values are outside the allowed range.'],
  '22P02': [400, 'One of the identifiers in this request is invalid.'],
  '22007': [400, 'One of the dates in this request is invalid.'],
};

export function toHttpError(error) {
  if (error instanceof multer.MulterError) return error.code === 'LIMIT_FILE_SIZE' ? [413, 'This file is larger than the allowed size.'] : [400, 'The uploaded file could not be read.'];
  if (error?.type === 'entity.parse.failed') return [400, 'The request body is not valid JSON.'];
  if (error?.type === 'entity.too.large') return [413, 'The request body is too large.'];
  if (error?.code && databaseErrors[error.code]) return databaseErrors[error.code];
  const status = Number(error?.status || error?.statusCode || 500);
  return status >= 400 && status < 500 ? [status, error.message] : [500, 'The request could not be completed.'];
}

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false);
app.use(helmet());
app.use(cors({ origin: config.frontendOrigin.split(',').map((item) => item.trim()), credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', authRoutes);
// There is deliberately no sign-up endpoint; unknown auth paths must not fall through to the authenticated API.
app.use('/api/auth', (_req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use('/api', api);
app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((error, _req, res, _next) => {
  const [status, message] = toHttpError(error);
  if (status >= 500 && config.nodeEnv !== 'test') console.error(error);
  res.status(status).json({ error: message });
});
