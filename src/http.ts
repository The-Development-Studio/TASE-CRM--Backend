import { NextFunction, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const asyncHandler = (
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>
) => (request: Request, response: Response, next: NextFunction) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

export const parseObjectId = (value: string) => {
  if (!ObjectId.isValid(value)) throw new HttpError(400, 'Invalid record ID');
  return new ObjectId(value);
};

export const serializeDocument = <T extends { _id?: ObjectId; appId?: string }>(document: T | null) => {
  if (!document) return null;
  const { _id, appId, ...rest } = document;
  return { ...rest, id: appId ?? _id?.toHexString() };
};

export const errorHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Validation failed', details: error.flatten() });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (typeof error === 'object' && error && 'code' in error && error.code === 11000) {
    response.status(409).json({ error: 'A record with this unique value already exists' });
    return;
  }

  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
};
