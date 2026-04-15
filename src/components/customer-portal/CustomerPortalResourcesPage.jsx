import React, { useState, useEffect } from 'react';
import { useResources } from '@/hooks/useResources';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, PlayCircle, FileText, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const CATEGORIES = ['All', 'Video', 'Document', 'Guide'];

export const CustomerPortalResourcesPage = () => {
  const { getResources, loading } = useResources();
  const [resources, setResources] = useState([]);
  const [filteredResources, setFilteredResources] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const loadResources = async () => {
      const data = await getResources();
      if (data) {
        setResources(data);
        setFilteredResources(data);
      }
    };
    loadResources();
  }, [getResources]);

  useEffect(() => {
    let result = resources;
    if (activeCategory !== 'All') {
      result = result.filter(r => r.category === activeCategory);
    }
    if (searchQuery.trim()) {
      result = result.filter(r => 
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    setFilteredResources(result);
  }, [activeCategory, searchQuery, resources]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">How-To & Guides</h2>
        <p className="text-sm text-blue-200">Access helpful guides, videos, and documents.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-black/20 p-4 rounded-xl border border-white/10">
        <div className="flex overflow-x-auto gap-2 w-full md:w-auto pb-2 md:pb-0 hide-scrollbar">
          {CATEGORIES.map(category => (
            <Button
              key={category}
              variant={activeCategory === category ? 'default' : 'outline'}
              className={`whitespace-nowrap ${
                activeCategory === category 
                  ? 'bg-yellow-400 text-blue-900 hover:bg-yellow-500 border-none' 
                  : 'text-white border-white/20 hover:bg-white/10'
              }`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input 
            placeholder="Search resources..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-black/30 border-white/20 text-white placeholder:text-gray-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
             <div key={i} className="animate-pulse bg-gray-800/50 rounded-xl h-64 border border-gray-700"></div>
          ))}
        </div>
      ) : filteredResources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredResources.map(resource => (
            <div 
                key={resource.id} 
                onClick={() => navigate(`/customer-portal/resources/${resource.id}`)}
                className="bg-black/20 border border-white/10 rounded-xl overflow-hidden hover:bg-white/5 transition-colors cursor-pointer group flex flex-col h-full"
            >
                <div className="aspect-video relative bg-black/40 flex items-center justify-center overflow-hidden">
                    {resource.cover_image_url ? (
                        <img src={resource.cover_image_url} alt={resource.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                        resource.category === 'Video' ? <PlayCircle className="w-12 h-12 text-gray-500" /> : <FileText className="w-12 h-12 text-gray-500" />
                    )}
                    <div className="absolute top-3 right-3 bg-black/60 backdrop-blur text-white text-xs px-2 py-1 rounded-md font-medium border border-white/10 flex items-center gap-1">
                        {resource.category === 'Video' ? <PlayCircle className="w-3 h-3" /> : resource.category === 'Document' ? <FileText className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
                        {resource.category}
                    </div>
                </div>
                <div className="p-5 flex flex-col flex-grow">
                    <h3 className="text-lg font-bold text-white mb-2 line-clamp-2 group-hover:text-yellow-400 transition-colors">{resource.title}</h3>
                    <p className="text-gray-400 text-sm line-clamp-3 mb-4 flex-grow">
                        {resource.description || 'No description provided.'}
                    </p>
                    <div className="mt-auto">
                        <span className="text-yellow-400 text-sm font-medium flex items-center group-hover:underline">
                            View Resource →
                        </span>
                    </div>
                </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-black/20 rounded-xl border border-white/10">
          <h3 className="text-xl text-white mb-2">No resources found</h3>
          <p className="text-gray-400">Try adjusting your search or category filters.</p>
        </div>
      )}
    </div>
  );
};