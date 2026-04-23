
import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import ProductShowcase from '@/components/ProductShowcase';
import ProductModal from '@/components/ProductModal';

const ProductShowcasePage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  return (
    <>
      <Helmet>
        <title>Gorilla Heavy-Duty Dump Cart - Product Showcase | U-Fill Dumpsters</title>
        <meta 
          name="description" 
          content="Explore the Gorilla Heavy-Duty Dump Cart - a professional-grade material handling solution with 1,200 lb capacity, patented quick-release dumping system, and all-terrain capability." 
        />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900">
        <ProductShowcase onOpenModal={handleOpenModal} />
        <ProductModal isOpen={isModalOpen} onClose={handleCloseModal} />
      </div>
    </>
  );
};

export default ProductShowcasePage;
