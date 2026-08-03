import { NextFunction, Request, Response } from 'express';
import { AuthService, DeviceTokenClaims, UserTokenClaims } from '../services/AuthService';
import { HttpError } from './errors';
import { logger } from '../utils/logger';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserTokenClaims;
    device?: DeviceTokenClaims;
  }
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing Authorization header');
  return header.slice('Bearer '.length);
}

export function requireUser(auth: AuthService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.user = auth.verifyUserToken(bearerToken(req));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Accepts a device token (issued by /register-device); used for peer-scoped APIs. */
export function requireDevice(auth: AuthService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.device = auth.verifyDeviceToken(bearerToken(req));
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error('Unhandled error', { err });
  res.status(500).json({ error: 'Internal server error' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
