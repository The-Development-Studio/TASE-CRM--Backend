import { Router } from 'express';
import { Filter, ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDatabase } from '../database.js';
import { asyncHandler, HttpError, parseObjectId, serializeDocument } from '../http.js';
import { ResourceName } from '../schemas.js';

interface CrudOptions {
  resource: ResourceName;
  schema: z.ZodObject;
  searchFields?: string[];
  userOwnershipField?: string;
}

export const createCrudRouter = ({ resource, schema, searchFields = [], userOwnershipField }: CrudOptions) => {
  const router = Router();
  const syncSchema = z.object({
    upsert: z.array(z.record(z.string(), z.unknown()).and(z.object({ id: z.string().trim().min(1).max(160) }))).max(250),
    deleteIds: z.array(z.string().trim().min(1).max(160)).max(250).default([])
  });

  router.get('/', asyncHandler(async (request, response) => {
    const db = await getDatabase();
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 10000);
    const filter: Filter<Record<string, unknown>> = {};
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
    const customerId = typeof request.query.customerId === 'string' ? request.query.customerId : '';

    if (userOwnershipField && request.staffUser?.role === 'user') {
      filter[userOwnershipField] = request.staffUser.name;
    }

    if (search && searchFields.length) {
      filter.$or = searchFields.map((field) => ({ [field]: { $regex: search, $options: 'i' } }));
    }
    if (customerId) filter.customerId = customerId;

    const records = await db.collection(resource).find(filter).sort({ updatedAt: -1 }).limit(limit).toArray();
    response.json({ data: records.map(serializeDocument), count: records.length });
  }));

  router.put('/sync', asyncHandler(async (request, response) => {
    const input = syncSchema.parse(request.body);
    const db = await getDatabase();
    const ownerName = userOwnershipField && request.staffUser?.role === 'user'
      ? request.staffUser.name
      : null;
    if (ownerName && userOwnershipField && input.upsert.some((item) => item[userOwnershipField] !== ownerName)) {
      throw new HttpError(403, 'Users can only save records assigned to themselves');
    }
    const operations = input.upsert.map((item) => {
      const { id, ...record } = item;
      const values = schema.parse(record) as Record<string, unknown>;
      return {
        updateOne: {
          filter: { appId: id, ...(ownerName && userOwnershipField ? { [userOwnershipField]: ownerName } : {}) },
          update: {
            $set: { ...values, appId: id, updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() }
          },
          upsert: true
        }
      };
    });
    if (operations.length) await db.collection(resource).bulkWrite(operations);
    if (input.deleteIds.length) {
      await db.collection(resource).deleteMany({
        appId: { $in: input.deleteIds },
        ...(ownerName && userOwnershipField ? { [userOwnershipField]: ownerName } : {})
      });
    }
    response.json({ upserted: operations.length, deleted: input.deleteIds.length });
  }));

  router.post('/', asyncHandler(async (request, response) => {
    const db = await getDatabase();
    const values = schema.parse(request.body) as Record<string, unknown>;
    if (userOwnershipField && request.staffUser?.role === 'user' && values[userOwnershipField] !== request.staffUser.name) {
      throw new HttpError(403, 'Users can only create records assigned to themselves');
    }
    const now = new Date();
    const appId = typeof request.body?.id === 'string' ? request.body.id : undefined;
    const result = await db.collection(resource).insertOne({ ...values, ...(appId ? { appId } : {}), createdAt: now, updatedAt: now });
    const created = await db.collection(resource).findOne({ _id: result.insertedId });
    response.status(201).json({ data: serializeDocument(created) });
  }));

  router.get('/:id', asyncHandler(async (request, response) => {
    const db = await getDatabase();
    const id = String(request.params.id);
    const record = await db.collection(resource).findOne({
      $and: [
        { $or: [{ appId: id }, ...(ObjectId.isValid(id) ? [{ _id: parseObjectId(id) }] : [])] },
        ...(userOwnershipField && request.staffUser?.role === 'user'
          ? [{ [userOwnershipField]: request.staffUser.name }]
          : [])
      ]
    });
    if (!record) throw new HttpError(404, 'Record not found');
    response.json({ data: serializeDocument(record) });
  }));

  router.patch('/:id', asyncHandler(async (request, response) => {
    const db = await getDatabase();
    const values = schema.partial().parse(request.body) as Record<string, unknown>;
    if (userOwnershipField && request.staffUser?.role === 'user' &&
      values[userOwnershipField] !== undefined && values[userOwnershipField] !== request.staffUser.name) {
      throw new HttpError(403, 'Users cannot reassign records');
    }
    const id = String(request.params.id);
    const record = await db.collection(resource).findOneAndUpdate(
      {
        $and: [
          { $or: [{ appId: id }, ...(ObjectId.isValid(id) ? [{ _id: parseObjectId(id) }] : [])] },
          ...(userOwnershipField && request.staffUser?.role === 'user'
            ? [{ [userOwnershipField]: request.staffUser.name }]
            : [])
        ]
      },
      { $set: { ...values, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!record) throw new HttpError(404, 'Record not found');
    response.json({ data: serializeDocument(record) });
  }));

  router.delete('/:id', asyncHandler(async (request, response) => {
    const db = await getDatabase();
    const id = String(request.params.id);
    const result = await db.collection(resource).deleteOne({
      $and: [
        { $or: [{ appId: id }, ...(ObjectId.isValid(id) ? [{ _id: parseObjectId(id) }] : [])] },
        ...(userOwnershipField && request.staffUser?.role === 'user'
          ? [{ [userOwnershipField]: request.staffUser.name }]
          : [])
      ]
    });
    if (!result.deletedCount) throw new HttpError(404, 'Record not found');
    response.status(204).send();
  }));

  return router;
};
