import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin, supabaseConfigured } from './supabaseClient.js';

export type AccessRole = 'admin' | 'employee';
export type Position = 'manager' | 'staff';

export type AuthedUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: AccessRole;
  position: Position;
  department: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/** Verifies the Supabase session token and loads the caller's role/position/department. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!supabaseConfigured) return res.status(503).send('Auth is not configured on this server yet.');

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).send('Missing Authorization header.');

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData.user) return res.status(401).send('Invalid or expired session.');

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name, role, position, department')
    .eq('id', userData.user.id)
    .single();
  if (profileErr || !profile) return res.status(403).send('No profile is set up for this account yet.');

  req.user = {
    id: userData.user.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    position: profile.position,
    department: profile.department,
  };
  next();
}

/**
 * Admin accounts are observers: they review coaching, they do not request it.
 *
 * Requesting coaching downloads a customer recording, transcribes it and pays a model to read
 * it. That is the agent's own call to make about their own work — and an admin browsing the
 * whole company could spend a lot of it by clicking around. Admins therefore see every agent's
 * calls and every piece of coaching that exists, and cannot create new ones.
 *
 * Enforced here rather than by hiding buttons: the UI hides them too, but that is a courtesy.
 */
export function requireCoachingRights(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin') {
    return res.status(403).json({
      error:
        'Admin accounts are read-only for coaching: you can review coaching that already exists, but not request new coaching.',
    });
  }
  next();
}

/** email -> department, for every profile. Only the server (service-role key) can see this. */
export async function departmentByEmail(): Promise<Record<string, string | null>> {
  const { data, error } = await supabaseAdmin.from('profiles').select('email, department');
  if (error || !data) return {};
  return Object.fromEntries(data.map((p) => [p.email, p.department]));
}

/** True if `user` is allowed to see a call/agent whose owner has the given email. */
export async function canAccessAgentEmail(user: AuthedUser, agentEmail: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.position === 'manager') {
    const depts = await departmentByEmail();
    return user.department !== null && depts[agentEmail] === user.department;
  }
  return user.email === agentEmail;
}
