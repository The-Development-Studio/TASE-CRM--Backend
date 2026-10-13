import { z } from 'zod';

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().optional().default('');
const dateText = z.string().trim().optional().default('');

export const customerSchema = z.object({
  customerCode: requiredText,
  companyName: requiredText,
  customerType: z.enum(['Enterprise', 'SMB', 'Startup', 'Government', 'Partner']),
  industry: z.enum(['FinTech', 'Healthcare', 'E-Commerce', 'SaaS & Cloud', 'Logistics', 'Manufacturing', 'EdTech']),
  primaryContact: optionalText,
  email: z.union([z.email(), z.literal('')]).default(''),
  phone: optionalText,
  totalDealsValue: z.number().nonnegative().default(0),
  activeContracts: z.number().int().nonnegative().default(0),
  amcStatus: z.enum(['Active', 'Expiring Soon', 'Expired', 'None']).default('None'),
  renewalDate: dateText,
  relationshipManager: optionalText,
  city: optionalText,
  internalDocumentLink: z.union([z.url(), z.literal('')]).optional().default('')
});

export const leadSchema = z.object({
  customerId: z.string().optional(),
  name: requiredText,
  designation: optionalText,
  company: requiredText,
  email: z.union([z.email(), z.literal('')]).default(''),
  phone: optionalText,
  whatsapp: optionalText,
  website: optionalText,
  source: z.enum(['Meta Ads', 'Instagram', 'Google Ads', 'Website', 'Referral', 'Direct', 'Other']),
  campaign: optionalText,
  interestedService: optionalText,
  estimatedBudget: z.number().nonnegative().default(0),
  leadOwner: optionalText,
  status: z.enum(['New', 'Assigned', 'Contacted', 'Requirement Collected', 'Qualified', 'Opportunity Created', 'Unqualified', 'Converted']),
  priority: z.enum(['High', 'Medium', 'Low', 'Urgent']),
  nextFollowUp: dateText,
  nextFollowUpTime: optionalText,
  createdDate: dateText,
  requirement: optionalText,
  commercialNotes: optionalText,
  notes: z.array(z.string()).default([])
});

const relatedRecord = z.object({
  customerId: z.string().optional(),
  leadId: z.string().optional()
}).catchall(z.unknown());

export const activitySchema = relatedRecord.extend({
  title: requiredText,
  type: requiredText,
  date: dateText,
  time: optionalText,
  status: requiredText
});

export const opportunitySchema = relatedRecord.extend({ name: requiredText, stage: requiredText });
export const proposalSchema = relatedRecord.extend({ proposalNumber: requiredText, title: requiredText });
export const invoiceSchema = relatedRecord.extend({ invoiceNo: requiredText, customer: optionalText });
export const contractSchema = relatedRecord.extend({ contractNo: requiredText, customer: optionalText });
export const projectSchema = relatedRecord.extend({
  name: requiredText,
  status: z.enum(['Planned', 'In Progress', 'On Hold', 'Completed', 'Cancelled']),
  owner: optionalText,
  startDate: dateText,
  targetDate: dateText,
  progress: z.number().int().min(0).max(100).default(0),
  description: optionalText
});
export const documentSchema = z.object({
  customerId: requiredText,
  name: requiredText,
  category: requiredText,
  mimeType: requiredText,
  size: z.number().int().nonnegative(),
  storageKey: requiredText,
  downloadUrl: z.url().optional(),
  uploadedBy: optionalText,
  client: optionalText
});

export const organizationSchema = z.object({ organizationKey: z.string().default('default') }).catchall(z.unknown());

export const resourceSchemas = {
  customers: customerSchema,
  leads: leadSchema,
  activities: activitySchema,
  opportunities: opportunitySchema,
  proposals: proposalSchema,
  invoices: invoiceSchema,
  contracts: contractSchema,
  projects: projectSchema,
  documents: documentSchema,
  organizations: organizationSchema
} as const;

export type ResourceName = keyof typeof resourceSchemas;
