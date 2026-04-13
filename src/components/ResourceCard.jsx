
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { FileText, Video, BookOpen, ExternalLink } from 'lucide-react';

export const ResourceCard = ({ resource }) => {
  const navigate = useNavigate();

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'Video': return <Video className="w-4 h-4 mr-1" />;
      case 'Document': return <FileText className="w-4 h-4 mr-1" />;
      case 'Guide': return <BookOpen className="w-4 h-4 mr-1" />;
      default: return <FileText className="w-4 h-4 mr-1" />;
    }
  };

  return (
    <Card 
      className="overflow-hidden interactive-hover cursor-pointer bg-card/50 backdrop-blur-sm border-white/10 hover:border-primary/50 group tap-target h-full flex flex-col"
      onClick={() => navigate(`/resource/${resource.id}`)}
    >
      {resource.cover_image_url ? (
        <div className="relative w-full h-48 overflow-hidden bg-muted">
          <img 
            src={resource.cover_image_url} 
            alt={resource.title} 
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <ExternalLink className="text-white w-8 h-8" />
          </div>
        </div>
      ) : (
        <div className="w-full h-48 bg-muted flex items-center justify-center text-muted-foreground">
          {getCategoryIcon(resource.category)}
        </div>
      )}
      
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start mb-2">
          <Badge variant="secondary" className="flex items-center text-xs">
            {getCategoryIcon(resource.category)}
            {resource.category}
          </Badge>
        </div>
        <CardTitle className="text-lg line-clamp-2">{resource.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-grow">
        <CardDescription className="line-clamp-3 text-sm text-muted-foreground">
          {resource.description || 'No description available.'}
        </CardDescription>
      </CardContent>
    </Card>
  );
};
