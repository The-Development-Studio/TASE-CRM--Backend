import { Router } from 'express';
import { getDatabase } from '../database.js';
import { asyncHandler, HttpError, parseObjectId, serializeDocument } from '../http.js';

export const customer360Router = Router();

customer360Router.get('/:id/360', asyncHandler(async (request, response) => {
  const db = await getDatabase();
  const customerId = String(request.params.id);
  const customer = await db.collection('customers').findOne({ _id: parseObjectId(customerId) });
  if (!customer) throw new HttpError(404, 'Customer not found');

  const relatedFilter = { customerId };
  const [leads, activities, opportunities, proposals, invoices, contracts, documents, emails] = await Promise.all([
    db.collection('leads').find(relatedFilter).sort({ updatedAt: -1 }).toArray(),
    db.collection('activities').find(relatedFilter).sort({ date: -1, time: -1 }).toArray(),
    db.collection('opportunities').find(relatedFilter).sort({ updatedAt: -1 }).toArray(),
    db.collection('proposals').find(relatedFilter).sort({ updatedAt: -1 }).toArray(),
    db.collection('invoices').find(relatedFilter).sort({ issueDate: -1 }).toArray(),
    db.collection('contracts').find(relatedFilter).sort({ expiryDate: 1 }).toArray(),
    db.collection('documents').find(relatedFilter).sort({ updatedAt: -1 }).toArray(),
    db.collection('email_messages').find(relatedFilter).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  response.json({
    data: {
      customer: serializeDocument(customer),
      leads: leads.map(serializeDocument),
      activities: activities.map(serializeDocument),
      opportunities: opportunities.map(serializeDocument),
      proposals: proposals.map(serializeDocument),
      invoices: invoices.map(serializeDocument),
      contracts: contracts.map(serializeDocument),
      documents: documents.map(serializeDocument),
      emails: emails.map(serializeDocument)
    }
  });
}));
