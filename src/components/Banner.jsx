import React from 'react';
import { siteImages } from '@/config/siteImages';

export const Banner = () => {
  return (
    <div className="relative w-full bg-white overflow-hidden aspect-[2400/448]">
      <img
        src={siteImages.banner}
        alt="Your complete DIY rental partner — mini excavators, mini loaders, dump trailers, and roll-off dumpsters. Premium mulch, gravel driveways, and patio projects, simplified."
        width={2400}
        height={448}
        className="w-full h-auto object-contain object-center bg-transparent select-none"
        draggable={false}
      />
    </div>
  );
};
