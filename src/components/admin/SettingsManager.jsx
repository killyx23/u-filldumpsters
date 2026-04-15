import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Key } from 'lucide-react';

export const SettingsManager = () => {
  const [apiKey, setApiKey] = useState('');
  const [isSet, setIsSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /></div>;
  }

  return (
    <div className="space-y-6">
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
    </div>
  );
};