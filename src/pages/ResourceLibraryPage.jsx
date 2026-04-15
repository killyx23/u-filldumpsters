import React, { useState, useEffect } from 'react';
import { useResources } from '@/hooks/useResources';
import { ResourceCard } from '@/components/ResourceCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2 } from 'lucide-react';
import { Helmet } from 'react-helmet';

const CATEGORIES = ['All', 'Video', 'Document', 'Guide'];

const ResourceLibraryPage = () => {
  const { fetchAllResources, loading } = useResources();
  const [resources, setResources] = useState([]);
  const [filteredResources, setFilteredResources] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadResources = async () => {
      const data = await fetchAllResources();
      if (data) {
        setResources(data);
        setFilteredResources(data);
      }
    };
    loadResources();
  }, [fetchAllResources]);

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
    <div className="container mx-auto px-4 py-12 max-w-7xl">
      <Helmet>
        <title>Resource Library | U-Fill Dumpsters</title>
        <meta name="description" content="Access our library of helpful guides, videos, and documents to make your dumpster rental experience seamless." />
      </Helmet>

      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">How-To & Guides</h1>
        <p className="text-xl text-blue-200 max-w-2xl mx-auto">
          Everything you need to know about dumpster rentals, waste management, and maximizing your efficiency.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8 justify-between items-center bg-white/5 p-4 rounded-xl backdrop-blur-md border border-white/10">
        <div className="flex overflow-x-auto gap-2 w-full md:w-auto pb-2 md:pb-0 hide-scrollbar">
          {CATEGORIES.map(category => (
            <Button
              key={category}
              variant={activeCategory === category ? 'default' : 'outline'}
              className={`tap-target whitespace-nowrap ${
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search resources..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-black/20 border-white/20 text-white placeholder:text-gray-400 tap-target"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-12 h-12 animate-spin text-yellow-400" />
        </div>
      ) : filteredResources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredResources.map(resource => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-black/20 rounded-xl border border-white/10">
          <h3 className="text-2xl text-white mb-2">No resources found</h3>
          <p className="text-blue-200">Try adjusting your search or category filters.</p>
        </div>
      )}
    </div>
  );
};

export default ResourceLibraryPage;