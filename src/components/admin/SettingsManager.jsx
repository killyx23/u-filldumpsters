import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Key, UserPlus, Copy, Unlock } from 'lucide-react';
import { AdminMfaSettings } from '@/components/admin/AdminMfaSettings';

export const SettingsManager = () => {
  const { isAdmin } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [isSet, setIsSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInvitePassword, setLastInvitePassword] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('business_settings')
        .select('*')
        .eq('setting_key', 'google_maps_api_key')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data && data.setting_value?.api_key) {
        setIsSet(true);
        setApiKey(''); // Don't show the actual key
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('business_settings')
        .upsert({
          setting_key: 'google_maps_api_key',
          setting_value: { api_key: apiKey.trim() }
        }, { onConflict: 'setting_key' });

      if (error) throw error;

      toast({
        title: 'Settings Saved',
        description: 'Google Maps API Key has been updated successfully.',
      });
      setIsSet(true);
      setApiKey('');
    } catch (error) {
      toast({
        title: 'Error saving settings',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleInviteAdmin = async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;

    setInviting(true);
    setLastInvitePassword(null);

    try {
      const { data, error } = await supabase.functions.invoke('create-admin', {
        body: {
          email,
          ...(inviteFullName.trim() ? { full_name: inviteFullName.trim() } : {}),
        },
      });

      if (error) {
        let message = error.message;
        try {
          const errContext = await error.context?.json();
          if (errContext?.error) message = errContext.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      setLastInvitePassword(data.temporary_password);
      toast({
        title: 'Admin invited',
        description: `Account created for ${data.email}. Copy the temporary password below — it is shown only once.`,
      });
      setInviteEmail('');
      setInviteFullName('');
    } catch (error) {
      toast({
        title: 'Could not invite admin',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  const copyTempPassword = async () => {
    if (!lastInvitePassword) return;
    try {
      await navigator.clipboard.writeText(lastInvitePassword);
      toast({ title: 'Copied', description: 'Temporary password copied to clipboard.' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Select and copy the password manually.',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <AdminMfaSettings />

      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-bold text-white mb-2 flex items-center">
          <Unlock className="mr-2 h-5 w-5 text-purple-400" />
          Lock lifecycle testing
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Create a short-lived real padlock PIN on a booking and simulate unlock/lock events
          so you can verify Rented → Returned + email/SMS without waiting for a full rental window.
        </p>
        <Button asChild className="bg-purple-600 hover:bg-purple-700">
          <Link to="/admin/lock-test">Open Lock Test Lab</Link>
        </Button>
      </div>

      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Key className="mr-2 h-5 w-5 text-yellow-400" />
          Google Maps Integration
        </h2>
        
        <form onSubmit={handleSave} className="space-y-4 max-w-xl">
          <div>
            <Label className="text-gray-300">Google Maps API Key</Label>
            <div className="mt-2 flex gap-3">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isSet ? "••••••••••••••••••••••••" : "Enter API Key"}
                className="bg-gray-900 border-gray-700 text-white"
              />
              <Button type="submit" disabled={saving || !apiKey.trim()} className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Key
              </Button>
            </div>
            <p className="text-sm text-gray-400 mt-2">
              This key is used for delivery location map previews and is kept secure server-side.
              {isSet && <span className="text-green-400 ml-2">✓ Key is currently configured</span>}
            </p>
          </div>
        </form>
      </div>

      {isAdmin && (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center">
            <UserPlus className="mr-2 h-5 w-5 text-yellow-400" />
            Invite Admin
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Creates a new admin account with a one-time temporary password. They must enroll an authenticator app on first login. Existing users cannot be promoted here — use the Supabase Dashboard for that. The first admin must be configured in Supabase Dashboard (app_metadata: is_admin: true).
          </p>

          <form onSubmit={handleInviteAdmin} className="space-y-4 max-w-xl">
            <div>
              <Label className="text-gray-300">Email</Label>
              <Input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="newadmin@example.com"
                className="mt-2 bg-gray-900 border-gray-700 text-white"
                disabled={inviting}
              />
            </div>
            <div>
              <Label className="text-gray-300">Display name (optional)</Label>
              <Input
                type="text"
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                placeholder="Site Administrator"
                className="mt-2 bg-gray-900 border-gray-700 text-white"
                disabled={inviting}
              />
            </div>
            <Button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
            >
              {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
              Create admin account
            </Button>
          </form>

          {lastInvitePassword && (
            <div className="mt-4 p-4 rounded-md bg-gray-900 border border-yellow-500/40">
              <p className="text-sm text-yellow-200 font-medium mb-2">Temporary password (shown once)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-white break-all font-mono">{lastInvitePassword}</code>
                <Button type="button" variant="outline" size="sm" onClick={copyTempPassword} className="shrink-0 border-gray-600">
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Share this securely with the new admin. They should change it after first login at /admin-login.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};