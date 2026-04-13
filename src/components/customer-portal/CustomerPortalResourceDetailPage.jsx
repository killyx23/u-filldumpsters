
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useResources } from '@/hooks/useResources';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, Loader2, PlayCircle, FileText, Calendar } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export const CustomerPortalResourceDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getResourceById, loading } = useResources();
  const [resource, setResource] = useState(null);

  useEffect(() => {
    const loadResource = async () => {
      const data = await getResourceById(id);
      if (data) setResource(data);
    };
    loadResource();
  }, [id, getResourceById]);

  const getEmbedUrl = (url) => {
    if (!url) return null;
    if (url.includes('youtube.com/watch?v=')) {
      return url.replace('watch?v=', 'embed/');
    }
    if (url.includes('youtu.be/')) {
      return url.replace('youtu.be/', 'youtube.com/embed/');
    }
    return url;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="text-center py-20 bg-black/20 rounded-xl border border-white/10">
        <h3 className="text-2xl font-bold text-white mb-4">Resource Not Found</h3>
        <Button onClick={() => navigate('/portal?tab=resources')} variant="secondary">Back to Resources</Button>
      </div>
    );
  }

  const embedUrl = getEmbedUrl(resource.file_url);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button 
        variant="ghost" 
        onClick={() => navigate('/portal?tab=resources')} 
        className="text-gray-300 hover:text-white hover:bg-white/10 -ml-4"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Resources
      </Button>

      <div className="bg-black/20 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
        <div className="w-full bg-black/60 aspect-video relative flex items-center justify-center border-b border-white/10">
          {embedUrl ? (
             <iframe 
               src={embedUrl} 
               className="w-full h-full absolute inset-0"
               allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
               allowFullScreen
               title={resource.title}
             />
          ) : resource.pdf_url ? (
            <iframe 
              src={`${resource.pdf_url}#toolbar=0`} 
              className="w-full h-full absolute inset-0 bg-white"
              title={resource.title}
            />
          ) : resource.cover_image_url ? (
            <img src={resource.cover_image_url} alt={resource.title} className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center text-gray-500">
               {resource.category === 'Video' ? <PlayCircle className="w-16 h-16 mb-2" /> : <FileText className="w-16 h-16 mb-2" />}
               <p>No media preview available</p>
            </div>
          )}
        </div>

        <div className="p-6 md:p-8 space-y-8">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-blue-900 text-blue-100 border border-blue-700 text-xs font-semibold mb-3">
                {resource.category}
              </span>
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">{resource.title}</h1>
              <p className="text-sm text-gray-400 flex items-center gap-2">
                 <Calendar className="w-4 h-4" /> 
                 Added on {new Date(resource.created_at).toLocaleDateString()}
                 {resource.updated_at && resource.updated_at !== resource.created_at && 
                    ` (Updated ${new Date(resource.updated_at).toLocaleDateString()})`
                 }
              </p>
            </div>
            
            {resource.pdf_url && (
              <Button asChild className="bg-yellow-400 text-black hover:bg-yellow-500 shrink-0">
                <a href={resource.pdf_url} target="_blank" rel="noopener noreferrer" download>
                  <Download className="w-4 h-4 mr-2" /> Download PDF
                </a>
              </Button>
            )}
          </div>

          <div className="prose prose-invert max-w-none">
            <h3 className="text-lg font-semibold text-white mb-3">About this Resource</h3>
            <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">
              {resource.description || 'No additional details provided.'}
            </p>
          </div>

          {resource.qr_code_url && (
            <div className="pt-8 mt-8 border-t border-white/10">
                <h3 className="text-sm font-medium text-gray-400 mb-4 uppercase tracking-wider">Scan to View on Mobile</h3>
                <div className="bg-white p-4 rounded-xl inline-block">
                    <QRCodeSVG value={resource.qr_code_url} size={120} />
                </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
