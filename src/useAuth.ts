import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type AccessRole = 'admin' | 'employee';
export type Position = 'manager' | 'staff';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AccessRole;
  position: Position;
  department: string | null;
};

// Derived view mode: admin sees everything regardless of position; a manager's position scopes
// them to their own department; staff see only their own calls. See supabase/schema.sql.
export type ViewMode = 'admin' | 'manager' | 'staff';

export function viewModeFor(profile: Profile | null): ViewMode {
  if (!profile) return 'staff';
  if (profile.role === 'admin') return 'admin';
  return profile.position === 'manager' ? 'manager' : 'staff';
}

export function useAuth() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = not checked yet
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfileError(null);
    void supabase
      .from('profiles')
      .select('id, email, full_name, role, position, department')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setProfileError('Signed in, but no profile is set up for this account yet. Ask an admin to add one.');
          setProfile(null);
        } else {
          setProfile(data as Profile);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return {
    loading: session === undefined,
    session: session ?? null,
    profile,
    profileError,
    viewMode: viewModeFor(profile),
    signOut: () => supabase.auth.signOut(),
  };
}
