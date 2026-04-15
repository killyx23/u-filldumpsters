import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/hooks/use-toast';

export const useResources = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getResources = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('resources')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (err) throw err;
      return data;
    } catch (err) {
      setError(err.message);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to fetch resources' });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const getResourceById = useCallback(async (id) => {
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('resources')
        .select('*')
        .eq('id', id)
        .single();
      
      if (err) throw err;
      return data;
    } catch (err) {
      setError(err.message);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to fetch resource details' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const uploadFile = async (bucket, file) => {
    if (!file) return null;
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, file);
      
    if (uploadError) throw uploadError;
    
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);
      
    return publicUrl;
  };

  const createResource = useCallback(async (title, category, description, coverImageFile, fileUrl, pdfFile) => {
    setLoading(true);
    try {
      let coverUrl = null;
      let pdfUrl = null;
      
      if (coverImageFile) coverUrl = await uploadFile('resource-covers', coverImageFile);
      if (pdfFile) pdfUrl = await uploadFile('resource-files', pdfFile);

      const { data, error: err } = await supabase
        .from('resources')
        .insert([{ 
            title, 
            category, 
            description, 
            cover_image_url: coverUrl, 
            file_url: fileUrl, 
            pdf_url: pdfUrl 
        }])
        .select()
        .single();
        
      if (err) throw err;

      // Generate QR Code URL
      const qrCodeUrl = `${window.location.origin}/customer-portal/resources/${data.id}`;
      const { data: updatedData, error: updateErr } = await supabase
        .from('resources')
        .update({ qr_code_url: qrCodeUrl })
        .eq('id', data.id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      toast({ title: 'Success', description: 'Resource created successfully' });
      return updatedData;
    } catch (err) {
      setError(err.message);
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const updateResource = useCallback(async (id, updates, files = {}) => {
    setLoading(true);
    try {
      let coverUrl = updates.cover_image_url;
      let pdfUrl = updates.pdf_url;
      
      if (files?.cover) coverUrl = await uploadFile('resource-covers', files.cover);
      if (files?.pdf) pdfUrl = await uploadFile('resource-files', files.pdf);

      const { data, error: err } = await supabase
        .from('resources')
        .update({ ...updates, cover_image_url: coverUrl, pdf_url: pdfUrl, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
        
      if (err) throw err;
      toast({ title: 'Success', description: 'Resource updated successfully' });
      return data;
    } catch (err) {
      setError(err.message);
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const deleteResource = useCallback(async (id) => {
    setLoading(true);
    try {
      // Fetch resource to get file URLs
      const { data: resource } = await supabase.from('resources').select('*').eq('id', id).single();
      
      if (resource) {
        if (resource.cover_image_url) {
          const fileName = resource.cover_image_url.split('/').pop();
          await supabase.storage.from('resource-covers').remove([fileName]);
        }
        if (resource.pdf_url) {
          const fileName = resource.pdf_url.split('/').pop();
          await supabase.storage.from('resource-files').remove([fileName]);
        }
      }

      const { error: err } = await supabase
        .from('resources')
        .delete()
        .eq('id', id);
        
      if (err) throw err;
      toast({ title: 'Success', description: 'Resource deleted successfully' });
      return true;
    } catch (err) {
      setError(err.message);
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      return false;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    loading,
    error,
    getResources,
    getResourceById,
    createResource,
    updateResource,
    deleteResource
  };
};