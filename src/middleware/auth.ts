import { Request, Response, NextFunction } from 'express';

// Stub for JWT verification
export const verifyAuth = (req: Request, res: Response, next: NextFunction) => {
  // Logic to verify token against Supabase using verify()
  next();
};
