
import React, { useState, useEffect } from 'react';
import { useResources } from '@/hooks/useResources';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Plus, Edit, Trash2, Download } from 'lucide-react';
import { Label } from '@/components/ui/label';

export const ResourceManagement = () => {
  const { getResources, createResource, updateResource, deleteResource, loading } = useResources();
  const [resources, setResources] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  const [formData, setFormData] = useState({ title: '', category: 'Guide', description: '', file_url: '' });
  const [files, setFiles] = useState({ cover: null, pdf: null });

  const loadData = async () => {
    const data = await getResources();
    if (data) setResources(data);
  };

  useEffect(() => {
    loadData();
  }, [getResources]);

  const handleOpenDialog = (resource = null) => {
    if (resource) {
      setEditingId(resource.id);
      setFormData({
        title: resource.title,
        category: resource.category,
        description: resource.description || '',
        file_url: resource.file_url || '',
      });
    } else {
      setEditingId(null);
      setFormData({ title: '', category: 'Guide', description: '', file_url: '' });
    }
    setFiles({ cover: null, pdf: null });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (editingId) {
      await updateResource(editingId, formData, files);
    } else {
      await createResource(
        formData.title, 
        formData.category, 
        formData.description, 
        files.cover, 
        formData.file_url, 
        files.pdf
      );
    }
    setIsDialogOpen(false);
    loadData();
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this resource?')) {
      await deleteResource(id);
      loadData();
    }
  };

  const downloadQR = (resourceId, title) => {
    const svg = document.getElementById(`qr-${resourceId}`);
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");
      const downloadLink = document.createElement("a");
      downloadLink.download = `QR_${title.replace(/\s+/g, '_')}.png`;
      downloadLink.href = `${pngFile}`;
      downloadLink.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div className="p-6 bg-gray-800 rounded-lg shadow-sm border border-gray-700">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Resource Management</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()} className="bg-yellow-500 text-black hover:bg-yellow-600">
              <Plus className="w-4 h-4 mr-2" /> Add Resource
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] bg-gray-900 text-white border-gray-700 max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl text-yellow-400">{editingId ? 'Edit Resource' : 'Create Resource'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="bg-gray-800 text-white border-gray-700" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={val => setFormData({...formData, category: val})}>
                  <SelectTrigger className="bg-gray-800 text-white border-gray-700">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 text-white border-gray-700">
                    <SelectGroup>
                      <SelectItem value="Video">Video</SelectItem>
                      <SelectItem value="Document">Document</SelectItem>
                      <SelectItem value="Guide">Guide</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="bg-gray-800 text-white border-gray-700 min-h-[100px]" />
              </div>
              <div className="space-y-2">
                <Label>File Link (Video/External URL)</Label>
                <Input type="url" value={formData.file_url} onChange={e => setFormData({...formData, file_url: e.target.value})} className="bg-gray-800 text-white border-gray-700" placeholder="https://youtube.com/..." />
              </div>
              <div className="space-y-2">
                <Label>Cover Image Upload</Label>
                <Input type="file" accept="image/*" onChange={e => setFiles({...files, cover: e.target.files[0]})} className="bg-gray-800 text-white border-gray-700" />
              </div>
              <div className="space-y-2">
                <Label>PDF File Upload</Label>
                <Input type="file" accept=".pdf" onChange={e => setFiles({...files, pdf: e.target.files[0]})} className="bg-gray-800 text-white border-gray-700" />
              </div>
              
              <Button type="submit" disabled={loading} className="w-full bg-yellow-500 text-black hover:bg-yellow-600">
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {editingId ? 'Update Resource' : 'Create Resource'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-700">
              <TableHead className="text-gray-300">Thumbnail</TableHead>
              <TableHead className="text-gray-300">Title</TableHead>
              <TableHead className="text-gray-300">Category</TableHead>
              <TableHead className="text-gray-300">QR Code</TableHead>
              <TableHead className="text-right text-gray-300">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map((resource) => (
              <TableRow key={resource.id} className="border-gray-700 hover:bg-gray-700/50">
                <TableCell>
                    {resource.cover_image_url ? (
                        <img src={resource.cover_image_url} alt={resource.title} className="w-12 h-12 object-cover rounded" />
                    ) : (
                        <div className="w-12 h-12 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-500">No Img</div>
                    )}
                </TableCell>
                <TableCell className="font-medium text-white">{resource.title}</TableCell>
                <TableCell className="text-gray-300">{resource.category}</TableCell>
                <TableCell>
                  {resource.qr_code_url ? (
                     <div className="flex items-center gap-2">
                        <QRCodeSVG id={`qr-${resource.id}`} value={resource.qr_code_url} size={40} className="bg-white p-1 rounded" />
                        <Button variant="ghost" size="icon" onClick={() => downloadQR(resource.id, resource.title)} className="text-gray-400 hover:text-white" title="Download QR">
                            <Download className="h-4 w-4" />
                        </Button>
                     </div>
                  ) : <span className="text-gray-500 text-xs">No QR</span>}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="icon" onClick={() => handleOpenDialog(resource)} className="border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="destructive" size="icon" onClick={() => handleDelete(resource.id)} className="bg-red-900 text-red-100 hover:bg-red-800">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {resources.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                  No resources found. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
