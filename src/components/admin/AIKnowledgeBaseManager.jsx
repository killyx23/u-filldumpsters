
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Plus, Edit, Trash2, Search, BookOpen, Filter } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  fetchSections,
  fetchAllEntries,
  fetchEntriesBySection,
  createEntry,
  updateEntry,
  deleteEntry,
  searchEntries
} from '@/services/AIKnowledgeBaseService';

export const AIKnowledgeBaseManager = () => {
  const [sections, setSections] = useState([]);
  const [entries, setEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [deletingEntry, setDeletingEntry] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSection, setActiveSection] = useState('all');

  const [formData, setFormData] = useState({
    sectionId: '',
    title: '',
    content: ''
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [sectionsData, entriesData] = await Promise.all([
        fetchSections(),
        fetchAllEntries()
      ]);
      
      setSections(sectionsData);
      setEntries(entriesData);
      setFilteredEntries(entriesData);
    } catch (error) {
      toast({
        title: 'Failed to load knowledge base',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    handleFilter();
  }, [searchTerm, activeSection, entries]);

  const handleFilter = async () => {
    let filtered = entries;

    // Filter by search term
    if (searchTerm.trim()) {
      try {
        filtered = await searchEntries(searchTerm);
      } catch (error) {
        console.error('Search error:', error);
      }
    }

    // Filter by section
    if (activeSection !== 'all') {
      const sectionId = parseInt(activeSection);
      filtered = filtered.filter(entry => entry.section_id === sectionId);
    }

    setFilteredEntries(filtered);
  };

  const handleOpenDialog = (entry = null) => {
    if (entry) {
      setEditingEntry(entry);
      setFormData({
        sectionId: entry.section_id.toString(),
        title: entry.title,
        content: entry.content
      });
    } else {
      setEditingEntry(null);
      setFormData({
        sectionId: sections[0]?.id?.toString() || '',
        title: '',
        content: ''
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingEntry(null);
    setFormData({
      sectionId: '',
      title: '',
      content: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const sectionId = parseInt(formData.sectionId);

      if (editingEntry) {
        await updateEntry(
          editingEntry.id,
          formData.title,
          formData.content,
          sectionId
        );
        toast({
          title: 'Entry updated',
          description: 'Knowledge base entry has been updated successfully'
        });
      } else {
        await createEntry(
          sectionId,
          formData.title,
          formData.content
        );
        toast({
          title: 'Entry created',
          description: 'New knowledge base entry has been created successfully'
        });
      }

      handleCloseDialog();
      loadData();
    } catch (error) {
      toast({
        title: editingEntry ? 'Failed to update entry' : 'Failed to create entry',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteClick = (entry) => {
    setDeletingEntry(entry);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingEntry) return;

    setSubmitting(true);
    try {
      await deleteEntry(deletingEntry.id);
      toast({
        title: 'Entry deleted',
        description: 'Knowledge base entry has been deleted successfully'
      });
      setDeleteDialogOpen(false);
      setDeletingEntry(null);
      loadData();
    } catch (error) {
      toast({
        title: 'Failed to delete entry',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Knowledge Base Entries</h2>
          <p className="text-gray-400 text-sm">Training content for the AI Assistant</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Entry
        </Button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search entries by title or content..."
            className="bg-gray-800 border-gray-700 text-white pl-10"
          />
        </div>
        <Select value={activeSection} onValueChange={setActiveSection}>
          <SelectTrigger className="w-full sm:w-[200px] bg-gray-800 border-gray-700 text-white">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="all" className="text-white">All Sections</SelectItem>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id.toString()} className="text-white">
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Entries List */}
      <div className="space-y-3">
        {filteredEntries.length === 0 ? (
          <Card className="bg-gray-800 border-gray-700">
            <CardContent className="p-12 text-center">
              <BookOpen className="h-12 w-12 text-gray-600 mx-auto mb-4 opacity-50" />
              <p className="text-gray-400">
                {searchTerm || activeSection !== 'all' 
                  ? 'No entries match your search criteria' 
                  : 'No knowledge base entries yet. Create your first entry to train the AI.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredEntries.map((entry) => (
            <Card key={entry.id} className="bg-gray-800 border-gray-700 hover:bg-gray-750 transition-colors">
              <CardContent className="p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-block px-2 py-1 text-xs bg-blue-600/20 text-blue-400 rounded border border-blue-600/30">
                        {entry.section?.name || 'Unknown Section'}
                      </span>
                    </div>
                    <h3 className="font-bold text-white text-lg mb-2">{entry.title}</h3>
                    <p className="text-gray-400 text-sm line-clamp-2 mb-3">{entry.content}</p>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>Created: {format(parseISO(entry.created_at), 'MMM dd, yyyy')}</span>
                      <span>Updated: {format(parseISO(entry.updated_at), 'MMM dd, yyyy')}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenDialog(entry)}
                      className="h-8 w-8 p-0 text-gray-400 hover:text-white"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteClick(entry)}
                      className="h-8 w-8 p-0 text-gray-400 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEntry ? 'Edit Knowledge Base Entry' : 'Create New Entry'}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {editingEntry ? 'Update entry details' : 'Add new training content for the AI Assistant'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div>
              <Label htmlFor="entry-section" className="text-gray-300">Section *</Label>
              <Select
                value={formData.sectionId}
                onValueChange={(value) => setFormData({ ...formData, sectionId: value })}
                required
              >
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                  <SelectValue placeholder="Select a section" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id.toString()} className="text-white">
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="entry-title" className="text-gray-300">Title *</Label>
              <Input
                id="entry-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                className="bg-gray-800 border-gray-700 text-white mt-1"
                placeholder="e.g., What are our business hours?"
              />
            </div>

            <div>
              <Label htmlFor="entry-content" className="text-gray-300">Content *</Label>
              <Textarea
                id="entry-content"
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                required
                className="bg-gray-800 border-gray-700 text-white mt-1 resize-none"
                rows={10}
                placeholder="Detailed answer or information that the AI will use to respond to customer questions..."
              />
              <p className="text-xs text-gray-500 mt-1">
                This content will be used by the AI to answer customer questions. Be clear and comprehensive.
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseDialog}
                className="border-gray-700 text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !formData.title.trim() || !formData.content.trim() || !formData.sectionId}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                ) : (
                  editingEntry ? 'Update Entry' : 'Create Entry'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This action cannot be undone. This entry will be permanently removed from the knowledge base.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={submitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
