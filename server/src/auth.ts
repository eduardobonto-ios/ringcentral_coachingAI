import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin, supabaseConfigured } from './supabaseClient.js';

export type AccessRole = 'admin' | 'employee';
export type Position = 'manager' | 'staff';

export type AuthedUser = {
  id: string;
  email: string;
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
    .select('email, role, position, department')
    .eq('id', userData.user.id)
    .single();
  if (profileErr || !profile) return res.status(403).send('No profile is set up for this account yet.');

  req.user = {
    id: userData.user.id,
    email: profile.email,
    role: profile.role,
    position: profile.position,
    department: profile.department,
  };
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
