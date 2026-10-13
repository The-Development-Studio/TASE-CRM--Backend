import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { Resend } from 'resend';
import { z } from 'zod';
import { config, requireConfig } from '../config.js';
import { getDatabase } from '../database.js';
import { asyncHandler, HttpError } from '../http.js';
import { hashStaffSessionToken, staffSessionCookie } from '../staffAuth.js';
import { readStaffSession } from '../staffAuth.js';

const invitationSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  adminKey: z.string().min(1).optional()
});
const acceptInvitationSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(12).max(128)
});
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128)
});
const passwordResetRequestSchema = z.object({
  email: z.string().trim().email()
});
const passwordResetSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(12).max(128)
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const passwordHash = (password: string, salt = randomBytes(16).toString('hex')) => ({
  salt,
  passwordHash: scryptSync(password, salt, 64).toString('hex')
});
const matchesPassword = (password: string, salt: string, savedHash: string) => {
  const expected = Buffer.from(savedHash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
const resend = new Resend(config.RESEND_API_KEY ?? 're_not_configured');
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const invitationLifetimeMs = 24 * 60 * 60 * 1000;
const passwordResetLifetimeMs = 60 * 60 * 1000;
const passwordResetCooldownMs = 5 * 60 * 1000;
const passwordResetResponse = 'If an active staff account exists for that email, a password reset link has been sent.';

export const staffAuthRouter = Router();

staffAuthRouter.post('/invitations', asyncHandler(async (request, response) => {
  const values = invitationSchema.parse(request.body);
  const db = await getDatabase();
  const staffSession = await readStaffSession(request);
  const staffUsers = db.collection('staff_users');
  const userCount = await staffUsers.countDocuments();
  const isBootstrap = userCount === 0;
  if (isBootstrap) {
    if (!config.STAFF_ADMIN_KEY || !values.adminKey) throw new HttpError(503, 'Staff administrator bootstrap is not configured');
    const expected = Buffer.from(config.STAFF_ADMIN_KEY);
    const supplied = Buffer.from(values.adminKey);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new HttpError(403, 'Invalid staff administrator key');
    }
  } else if (!staffSession) {
    throw new HttpError(401, 'Staff sign-in required to invite staff');
  } else {
    const administrator = await staffUsers.findOne({ _id: new ObjectId(staffSession.id), role: 'admin', active: true });
    if (!administrator) throw new HttpError(403, 'Staff administrator access required');
  }
  if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
    throw new HttpError(503, 'Staff invitations require RESEND_API_KEY and RESEND_FROM_EMAIL to be configured on the backend');
  }
  const apiKey = requireConfig('RESEND_API_KEY');
  const from = requireConfig('RESEND_FROM_EMAIL');
  const email = values.email.toLowerCase();
  const rawToken = randomBytes(32).toString('hex');
  await db.collection('staff_invitations').updateOne(
    { email },
    {
      $set: {
        email,
        name: values.name,
        role: isBootstrap ? 'admin' : 'staff',
        tokenHash: hash(rawToken),
        expiresAt: new Date(Date.now() + invitationLifetimeMs),
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
  const mailer = apiKey === config.RESEND_API_KEY ? resend : new Resend(apiKey);
  const frontendOrigin = config.CLIENT_ORIGIN.split(',')[0].trim();
  const result = await mailer.emails.send({
    from,
    to: email,
    subject: 'Your TDS CRM staff invitation',
    html: `<p>Hello ${values.name.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)},</p><p><a href="${frontendOrigin}/staff-login?invite=${rawToken}">Accept your TDS CRM staff invitation</a></p><p>This link expires in 24 hours. Create a password of at least 12 characters to activate your account.</p>`
  });
  if (result.error) {
    await db.collection('staff_invitations').deleteOne({ tokenHash: hash(rawToken) });
    throw new HttpError(502, 'Could not send staff invitation');
  }
  response.status(202).json({ message: `Staff invitation sent to ${email}` });
}));

staffAuthRouter.post('/accept-invitation', asyncHandler(async (request, response) => {
  const values = acceptInvitationSchema.parse(request.body);
  const db = await getDatabase();
  const invitation = await db.collection('staff_invitations').findOne({
    tokenHash: hash(values.token),
    expiresAt: { $gt: new Date() }
  });
  if (!invitation) throw new HttpError(400, 'Staff invitation is invalid or has expired');
  const credentials = passwordHash(values.password);
  const now = new Date();
  await db.collection('staff_users').updateOne(
    { email: invitation.email },
    {
      $set: {
        email: invitation.email,
        name: invitation.name,
        role: invitation.role ?? 'staff',
        ...credentials,
        active: true,
        updatedAt: now
      },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true }
  );
  const user = await db.collection('staff_users').findOne({ email: invitation.email });
  if (user) await db.collection('staff_sessions').deleteMany({ userId: user._id });
  await db.collection('staff_invitations').deleteOne({ _id: invitation._id });
  response.status(201).json({ message: 'Staff account activated. You can now sign in.' });
}));

staffAuthRouter.post('/request-password-reset', asyncHandler(async (request, response) => {
  const values = passwordResetRequestSchema.parse(request.body);
  if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
    throw new HttpError(503, 'Password reset email is not configured');
  }

  const db = await getDatabase();
  const email = values.email.toLowerCase();
  const user = await db.collection('staff_users').findOne({ email, active: true });
  if (!user) {
    response.status(202).json({ message: passwordResetResponse });
    return;
  }

  const resetCollection = db.collection('staff_password_resets');
  const recentRequest = await resetCollection.findOne({
    email,
    createdAt: { $gt: new Date(Date.now() - passwordResetCooldownMs) }
  });
  if (recentRequest) {
    response.status(202).json({ message: passwordResetResponse });
    return;
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hash(rawToken);
  await resetCollection.updateOne(
    { email },
    {
      $set: {
        email,
        tokenHash,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + passwordResetLifetimeMs)
      }
    },
    { upsert: true }
  );

  const frontendOrigin = config.CLIENT_ORIGIN.split(',')[0].trim();
  const mailer = new Resend(requireConfig('RESEND_API_KEY'));
  const result = await mailer.emails.send({
    from: requireConfig('RESEND_FROM_EMAIL'),
    to: email,
    subject: 'Reset your TDS CRM password',
    html: `<p>Hello ${String(user.name ?? 'there').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)},</p><p><a href="${frontendOrigin}/staff-login?reset=${rawToken}">Reset your TDS CRM password</a></p><p>This link expires in one hour and can only be used once. If you did not request it, you can ignore this email.</p>`
  });
  if (result.error) {
    await resetCollection.deleteOne({ tokenHash });
    throw new HttpError(502, 'Could not send password reset email');
  }

  response.status(202).json({ message: passwordResetResponse });
}));

staffAuthRouter.post('/reset-password', asyncHandler(async (request, response) => {
  const values = passwordResetSchema.parse(request.body);
  const db = await getDatabase();
  const tokenHash = hash(values.token);
  const resetCollection = db.collection('staff_password_resets');
  const reset = await resetCollection.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() }
  });
  if (!reset || typeof reset.email !== 'string') {
    throw new HttpError(400, 'Password reset link is invalid or has expired');
  }

  const consumed = await resetCollection.deleteOne({ _id: reset._id, tokenHash });
  if (consumed.deletedCount !== 1) {
    throw new HttpError(400, 'Password reset link is invalid or has expired');
  }

  const credentials = passwordHash(values.password);
  const user = await db.collection('staff_users').findOneAndUpdate(
    { email: reset.email, active: true },
    { $set: { ...credentials, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!user) throw new HttpError(400, 'Password reset link is invalid or has expired');

  await Promise.all([
    db.collection('staff_sessions').deleteMany({ userId: user._id }),
    resetCollection.deleteMany({ email: reset.email }),
    db.collection('staff_login_attempts').deleteOne({ key: hash(`${reset.email}:${request.ip}`) })
  ]);
  response.json({ message: 'Password updated. You can now sign in.' });
}));

staffAuthRouter.post('/login', asyncHandler(async (request, response) => {
  const values = loginSchema.parse(request.body);
  const db = await getDatabase();
  const email = values.email.toLowerCase();
  const attemptKey = hash(`${email}:${request.ip}`);
  const attempts = await db.collection('staff_login_attempts').findOne({
    key: attemptKey,
    expiresAt: { $gt: new Date() }
  });
  if (attempts && Number(attempts.count) >= 10) {
    throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  }
  const user = await db.collection('staff_users').findOne({ email, active: true });
  const valid = user && typeof user.salt === 'string' && typeof user.passwordHash === 'string' &&
    matchesPassword(values.password, user.salt, user.passwordHash);
  if (!valid) {
    const now = new Date();
    await db.collection('staff_login_attempts').updateOne(
      { key: attemptKey },
      {
        $set: { expiresAt: new Date(now.getTime() + 15 * 60 * 1000) },
        $setOnInsert: { key: attemptKey },
        $inc: { count: 1 }
      },
      { upsert: true }
    );
    throw new HttpError(401, 'Email or password is incorrect');
  }
  await db.collection('staff_login_attempts').deleteOne({ key: attemptKey });
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await db.collection('staff_sessions').insertOne({
    tokenHash: hashStaffSessionToken(token),
    userId: user._id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + sessionLifetimeMs)
  });
  response.cookie(staffSessionCookie, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api',
    maxAge: sessionLifetimeMs
  });
  response.json({ data: { email: user.email, name: user.name, role: user.role } });
}));

staffAuthRouter.get('/session', asyncHandler(async (request, response) => {
  const cookieHeader = request.header('cookie') ?? '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${staffSessionCookie}=`));
  if (!cookie) throw new HttpError(401, 'Staff sign-in required');
  const db = await getDatabase();
  const session = await db.collection('staff_sessions').findOne({
    tokenHash: hashStaffSessionToken(cookie.slice(staffSessionCookie.length + 1)),
    expiresAt: { $gt: new Date() }
  });
  if (!session) throw new HttpError(401, 'Staff sign-in required');
  const user = await db.collection('staff_users').findOne({ _id: session.userId, active: true });
  if (!user) throw new HttpError(401, 'Staff account is inactive');
  response.json({ data: { email: user.email, name: user.name, role: user.role } });
}));

staffAuthRouter.post('/logout', asyncHandler(async (request, response) => {
  const cookieHeader = request.header('cookie') ?? '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${staffSessionCookie}=`));
  if (cookie) {
    const db = await getDatabase();
    await db.collection('staff_sessions').deleteOne({
      tokenHash: hashStaffSessionToken(cookie.slice(staffSessionCookie.length + 1))
    });
  }
  response.clearCookie(staffSessionCookie, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api'
  });
  response.status(204).send();
}));
