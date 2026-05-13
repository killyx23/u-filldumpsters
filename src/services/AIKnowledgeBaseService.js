
import { supabase } from '@/lib/customSupabaseClient';

/**
 * AI Knowledge Base Service
 * Provides methods to manage AI knowledge base sections and entries
 */

// ===============================
// SECTIONS METHODS
// ===============================

/**
 * Fetch all knowledge base sections
 */
export const fetchSections = async () => {
  try {
    const { data, error } = await supabase
      .from('ai_knowledge_sections')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) throw error;

    console.log('[AIKnowledgeBase] Loaded sections:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('[AIKnowledgeBase] Error fetching sections:', error);
    throw new Error('Failed to load knowledge base sections');
  }
};

/**
 * Create a new knowledge base section
 */
export const createSection = async (name, description, displayOrder = 0) => {
  try {
    const { data, error } = await supabase
      .from('ai_knowledge_sections')
      .insert([{
        name,
        description,
        display_order: displayOrder
      }])
      .select()
      .single();

    if (error) throw error;

    console.log('[AIKnowledgeBase] Section created:', data.id);
    return data;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error creating section:', error);
    throw new Error('Failed to create section');
  }
};

/**
 * Update an existing section
 */
export const updateSection = async (id, name, description, displayOrder) => {
  try {
    const updates = { name, description };
    if (displayOrder !== undefined) {
      updates.display_order = displayOrder;
    }

    const { data, error } = await supabase
      .from('ai_knowledge_sections')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log('[AIKnowledgeBase] Section updated:', id);
    return data;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error updating section:', error);
    throw new Error('Failed to update section');
  }
};

/**
 * Delete a section (only if no entries exist)
 */
export const deleteSection = async (id) => {
  try {
    // Check if section has entries
    const { count, error: countError } = await supabase
      .from('ai_knowledge_base')
      .select('id', { count: 'exact', head: true })
      .eq('section_id', id);

    if (countError) throw countError;

    if (count > 0) {
      throw new Error('Cannot delete section with existing entries. Delete entries first.');
    }

    const { error } = await supabase
      .from('ai_knowledge_sections')
      .delete()
      .eq('id', id);

    if (error) throw error;

    console.log('[AIKnowledgeBase] Section deleted:', id);
    return true;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error deleting section:', error);
    throw error;
  }
};

// ===============================
// ENTRIES METHODS
// ===============================

/**
 * Fetch all knowledge base entries
 */
export const fetchAllEntries = async () => {
  try {
    const { data, error } = await supabase
      .from('ai_knowledge_base')
      .select(`
        *,
        section:ai_knowledge_sections(id, name, description)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log('[AIKnowledgeBase] Loaded all entries:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('[AIKnowledgeBase] Error fetching entries:', error);
    throw new Error('Failed to load knowledge base entries');
  }
};

/**
 * Fetch entries by section ID
 */
export const fetchEntriesBySection = async (sectionId) => {
  try {
    const { data, error } = await supabase
      .from('ai_knowledge_base')
      .select(`
        *,
        section:ai_knowledge_sections(id, name, description)
      `)
      .eq('section_id', sectionId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log('[AIKnowledgeBase] Loaded entries for section', sectionId, ':', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('[AIKnowledgeBase] Error fetching entries by section:', error);
    throw new Error('Failed to load section entries');
  }
};

/**
 * Create a new knowledge base entry
 */
export const createEntry = async (sectionId, title, content) => {
  try {
    const { data, error } = await supabase
      .from('ai_knowledge_base')
      .insert([{
        section_id: sectionId,
        title,
        content
      }])
      .select(`
        *,
        section:ai_knowledge_sections(id, name, description)
      `)
      .single();

    if (error) throw error;

    console.log('[AIKnowledgeBase] Entry created:', data.id);
    return data;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error creating entry:', error);
    throw new Error('Failed to create knowledge base entry');
  }
};

/**
 * Update an existing entry
 */
export const updateEntry = async (id, title, content, sectionId) => {
  try {
    const updates = { title, content };
    if (sectionId) {
      updates.section_id = sectionId;
    }

    const { data, error } = await supabase
      .from('ai_knowledge_base')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        section:ai_knowledge_sections(id, name, description)
      `)
      .single();

    if (error) throw error;

    console.log('[AIKnowledgeBase] Entry updated:', id);
    return data;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error updating entry:', error);
    throw new Error('Failed to update entry');
  }
};

/**
 * Delete an entry
 */
export const deleteEntry = async (id) => {
  try {
    const { error } = await supabase
      .from('ai_knowledge_base')
      .delete()
      .eq('id', id);

    if (error) throw error;

    console.log('[AIKnowledgeBase] Entry deleted:', id);
    return true;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error deleting entry:', error);
    throw new Error('Failed to delete entry');
  }
};

/**
 * Search entries by keyword
 */
export const searchEntries = async (keyword) => {
  try {
    if (!keyword || keyword.trim().length === 0) {
      return await fetchAllEntries();
    }

    const searchTerm = keyword.toLowerCase();

    const { data, error } = await supabase
      .from('ai_knowledge_base')
      .select(`
        *,
        section:ai_knowledge_sections(id, name, description)
      `)
      .or(`title.ilike.%${searchTerm}%,content.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log('[AIKnowledgeBase] Search results for', keyword, ':', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('[AIKnowledgeBase] Error searching entries:', error);
    throw new Error('Failed to search entries');
  }
};

/**
 * Get entry count by section
 */
export const getEntriesCountBySection = async (sectionId) => {
  try {
    const { count, error } = await supabase
      .from('ai_knowledge_base')
      .select('id', { count: 'exact', head: true })
      .eq('section_id', sectionId);

    if (error) throw error;

    return count || 0;
  } catch (error) {
    console.error('[AIKnowledgeBase] Error getting entry count:', error);
    return 0;
  }
};
