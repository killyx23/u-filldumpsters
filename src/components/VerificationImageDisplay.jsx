
import React from 'react';
import { useVerificationImageLoader } from '@/hooks/useVerificationImageLoader';
import { Loader2, Download, AlertTriangle, Image as ImageIcon, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const VerificationImageDisplay = ({ customerId, title = "Driver's License Images" }) => {
    const { images, loading, error, downloadImage, refetch } = useVerificationImageLoader(customerId);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-black/20 rounded-lg border border-white/5">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-400 mb-2" />
                <p className="text-gray-400 text-sm">Loading verification images...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/30 border border-red-500/50 p-4 rounded-lg flex flex-col items-center text-center">
                <AlertTriangle className="h-8 w-8 text-red-400 mb-2" />
                <p className="text-red-300 text-sm mb-4">Failed to load images: {error}</p>
                <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
            </div>
        );
    }

    if (!images || (!images.license_front_url && !images.license_back_url)) {
        return (
            <div className="bg-black/20 border border-white/5 p-8 rounded-lg flex flex-col items-center text-center">
                <ImageIcon className="h-12 w-12 text-gray-500 mb-3" />
                <p className="text-gray-400">No verification documents uploaded yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h4 className="font-semibold text-blue-200">{title}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {images.license_front_url && (
                    <div className="relative group flex flex-col">
                        <p className="text-xs text-gray-400 mb-1">Front</p>
                        <a href={images.license_front_url} target="_blank" rel="noopener noreferrer" className="block relative bg-black/40 rounded-lg overflow-hidden border border-white/10 aspect-video flex-grow">
                            <img src={images.license_front_url} alt="License Front" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <ExternalLink className="h-8 w-8 text-white" />
                            </div>
                        </a>
                        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => downloadImage(images.license_front_storage_path, `license-front-${customerId}`)}>
                            <Download className="h-4 w-4 mr-2" /> Download
                        </Button>
                    </div>
                )}
                {images.license_back_url && (
                    <div className="relative group flex flex-col">
                        <p className="text-xs text-gray-400 mb-1">Back</p>
                        <a href={images.license_back_url} target="_blank" rel="noopener noreferrer" className="block relative bg-black/40 rounded-lg overflow-hidden border border-white/10 aspect-video flex-grow">
                            <img src={images.license_back_url} alt="License Back" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <ExternalLink className="h-8 w-8 text-white" />
                            </div>
                        </a>
                        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => downloadImage(images.license_back_storage_path, `license-back-${customerId}`)}>
                            <Download className="h-4 w-4 mr-2" /> Download
                        </Button>
                    </div>
                )}
            </div>
            {images.verification_status && (
                <div className="mt-2 flex items-center text-sm text-gray-400">
                    <span className="mr-2">Status:</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                        images.verification_status === 'approved' ? 'bg-green-900/50 text-green-400 border border-green-500' :
                        images.verification_status === 'rejected' ? 'bg-red-900/50 text-red-400 border border-red-500' :
                        'bg-orange-900/50 text-orange-400 border border-orange-500'
                    }`}>
                        {images.verification_status}
                    </span>
                </div>
            )}
        </div>
    );
};
