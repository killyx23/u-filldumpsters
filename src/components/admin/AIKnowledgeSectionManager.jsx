
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Plus, Edit, Trash2, Layers } from 'lucide-react';
import { fetchSections, createSection, updateSection, deleteSection, getEntriesCountBySection } from '@/services/AIKnowledgeBaseService';

export const AIKnowledgeSectionManager = () => {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [deletingSection, setDeletingSection] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [entryCounts, setEntryCounts] = useState({});

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    displayOrder: 0
  });

  const loadSections = async () => {
    setLoading(true);
    try {
      const data = await fetchSections();
      setSections(data);

      // Load entry counts for each section
      const counts = {};
      for (const section of data) {
        counts[section.id] = await getEntriesCountBySection(section.id);
      }
      setEntryCounts(counts);
    } catch (error) {
      toast({
        title: 'Failed to load sections',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSections();
  }, []);

  const handleOpenDialog = (section = null) => {
    if (section) {
      setEditingSection(section);
      setFormData({
        name: section.name,
        description: section.description || '',
        displayOrder: section.display_order || 0
      });
    } else {
      setEditingSection(null);
      setFormData({
        name: '',
        description: '',
        displayOrder: sections.length
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingSection(null);
    setFormData({
      name: '',
      description: '',
      displayOrder: 0
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingSection) {
        await updateSection(
          editingSection.id,
          formData.name,
          formData.description,
          formData.displayOrder
        );
        toast({
          title: 'Section updated',
          description: 'Knowledge base section has been updated successfully'
        });
      } else {
        await createSection(
          formData.name,
          formData.description,
          formData.displayOrder
        );
        toast({
          title: 'Section created',
          description: 'New knowledge base section has been created successfully'
        });
      }

      handleCloseDialog();
      loadSections();
    } catch (error) {
      toast({
        title: editingSection ? 'Failed to update section' : 'Failed to create section',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteClick = (section) => {
    setDeletingSection(section);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSection) return;

    setSubmitting(true);
    try {
      await deleteSection(deletingSection.id);
      toast({
        title: 'Section deleted',
        description: 'Knowledge base section has been deleted successfully'
      });
      setDeleteDialogOpen(false);
      setDeletingSection(null);
      loadSections();
    } catch (error) {
      toast({
        title: 'Failed to delete section',
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
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Knowledge Base Sections</h2>
          <p className="text-gray-400 text-sm">Organize your AI training content into sections</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Section
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map((section) => (
          <Card key={section.id} className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-blue-400" />
                  <CardTitle className="text-lg text-white">{section.name}</CardTitle>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenDialog(section)}
                    className="h-8 w-8 p-0 text-gray-400 hover:text-white"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteClick(section)}
                    className="h-8 w-8 p-0 text-gray-400 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-gray-400 mb-3">
                {section.description || 'No description'}
              </CardDescription>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Display Order: {section.display_order}</span>
                <span className="text-blue-400 font-medium">
                  {entryCounts[section.id] || 0} {entryCounts[section.id] === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {sections.length === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-12 text-center">
            <Layers className="h-12 w-12 text-gray-600 mx-auto mb-4 opacity-50" />
            <p className="text-gray-400">No sections yet. Create your first section to organize knowledge base entries.</p>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSection ? 'Edit Section' : 'Create New Section'}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {editingSection ? 'Update section details' : 'Add a new section to organize knowledge base entries'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div>
              <Label htmlFor="section-name" className="text-gray-300">Section Name *</Label>
              <Input
                id="section-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="bg-gray-800 border-gray-700 text-white mt-1"
                placeholder="e.g., General Information"
              />
            </div>

            <div>
              <Label htmlFor="section-description" className="text-gray-300">Description</Label>
              <Textarea
                id="section-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-gray-800 border-gray-700 text-white mt-1 resize-none"
                rows={3}
                placeholder="Brief description of this section..."
              />
            </div>

            <div>
              <Label htmlFor="section-order" className="text-gray-300">Display Order</Label>
              <Input
                id="section-order"
                type="number"
                value={formData.displayOrder}
                onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })}
                className="bg-gray-800 border-gray-700 text-white mt-1"
                min="0"
              />
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
                disabled={submitting || !formData.name.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                ) : (
                  editingSection ? 'Update Section' : 'Create Section'
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
            <AlertDialogTitle>Delete Section?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {deletingSection && entryCounts[deletingSection.id] > 0 ? (
                <span className="text-red-400">
                  This section contains {entryCounts[deletingSection.id]} {entryCounts[deletingSection.id] === 1 ? 'entry' : 'entries'}. 
                  You must delete all entries before deleting this section.
                </span>
              ) : (
                'This action cannot be undone. Are you sure you want to delete this section?'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">
              Cancel
            </AlertDialogCancel>
            {deletingSection && entryCounts[deletingSection.id] === 0 && (
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                disabled={submitting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
