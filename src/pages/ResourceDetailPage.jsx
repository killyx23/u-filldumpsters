import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useResources } from '@/hooks/useResources';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, Share2, Loader2, PlayCircle, FileText } from 'lucide-react';
import { Helmet } from 'react-helmet';
import { useToast } from '@/hooks/use-toast';

const ResourceDetailPage = () => {
  const { resourceId } = useParams();
  const navigate = useNavigate();
  const { fetchResourceById, loading } = useResources();
  const { toast } = useToast();
  const [resource, setResource] = useState(null);

  useEffect(() => {
    const loadResource = async () => {
      const data = await fetchResourceById(resourceId);
      if (data) setResource(data);
    };
    loadResource();
  }, [resourceId, fetchResourceById]);

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: resource?.title,
        text: resource?.description,
        url: window.location.href,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast({ title: 'Link copied', description: 'Resource link copied to clipboard!' });
    }
  };

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
        <Loader2 className="w-12 h-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl font-bold text-white mb-4">Resource Not Found</h2>
        <Button onClick={() => navigate('/resources')} variant="secondary">Back to Library</Button>
      </div>
    );
  }

  const embedUrl = getEmbedUrl(resource.file_url);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Helmet>
        <title>{resource.title} | U-Fill Dumpsters</title>
        <meta name="description" content={resource.description || `View our ${resource.category} resource on U-Fill Dumpsters.`} />
      </Helmet>

      <Button 
        variant="ghost" 
        onClick={() => navigate('/resources')} 
        className="mb-6 text-blue-200 hover:text-white hover:bg-white/10 tap-target"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Resources
      </Button>

      <div className="bg-card/50 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
        {/* Media Section */}
        <div className="w-full bg-black/50 aspect-video relative flex items-center justify-center">
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
            <div className="flex flex-col items-center text-muted-foreground">
               {resource.category === 'Video' ? <PlayCircle className="w-16 h-16 mb-2" /> : <FileText className="w-16 h-16 mb-2" />}
               <p>No media preview available</p>
            </div>
          )}
        </div>

        {/* Content Section */}
        <div className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-primary/20 text-primary-foreground text-sm font-semibold mb-3">
                {resource.category}
              </span>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">{resource.title}</h1>
              <p className="text-sm text-blue-200">Added on {new Date(resource.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleShare} className="tap-target border-white/20 hover:bg-white/10">
                <Share2 className="w-4 h-4 mr-2" /> Share
              </Button>
              {resource.pdf_url && (
                <Button asChild className="tap-target bg-yellow-400 text-blue-900 hover:bg-yellow-500">
                  <a href={resource.pdf_url} target="_blank" rel="noopener noreferrer" download>
                    <Download className="w-4 h-4 mr-2" /> Download PDF
                  </a>
                </Button>
              )}
            </div>
          </div>

          <div className="prose prose-invert max-w-none">
            <h3 className="text-xl font-semibold mb-2 text-white">About this Resource</h3>
            <p className="text-blue-100 whitespace-pre-wrap text-lg leading-relaxed">
              {resource.description || 'No additional details provided for this resource.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResourceDetailPage;