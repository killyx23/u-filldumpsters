
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Loader2, AlertCircle } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { useToast } from '@/components/ui/use-toast';
import { getProducts, getProductQuantities } from '@/api/EcommerceApi';
import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';
import { UnavailableServiceModal } from '@/components/UnavailableServiceModal';

const placeholderImage = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzc0MTUxIi8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzlDQTNBRiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4K";

const ProductCard = ({ product, index, isUnavailable, onUnavailableClick }) => {
  const { addToCart } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();

  const displayVariant = useMemo(() => product.variants[0], [product]);
  const hasSale = useMemo(() => displayVariant && displayVariant.sale_price_in_cents !== null, [displayVariant]);
  const displayPrice = useMemo(() => hasSale ? displayVariant.sale_price_in_cents_formatted : displayVariant.price_in_cents_formatted, [displayVariant, hasSale]);
  const originalPrice = useMemo(() => hasSale ? displayVariant.price_in_cents_formatted : null, [displayVariant, hasSale]);

  const handleCardClick = (e) => {
    if (isUnavailable) {
      e.preventDefault();
      onUnavailableClick(product.title);
    }
  };

  const handleAddToCart = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (isUnavailable) {
      onUnavailableClick(product.title);
      return;
    }

    if (product.variants.length > 1) {
      navigate(`/product/${product.id}`);
      return;
    }

    const defaultVariant = product.variants[0];

    try {
      await addToCart(product, defaultVariant, 1, defaultVariant.inventory_quantity);
      toast({
        title: "Added to Cart! 🛒",
        description: `${product.title} has been added to your cart.`,
      });
    } catch (error) {
      toast({
        title: "Error adding to cart",
        description: error.message,
      });
    }
  }, [product, addToCart, toast, navigate, isUnavailable, onUnavailableClick]);

  const Wrapper = isUnavailable ? 'div' : Link;
  const wrapperProps = isUnavailable ? { onClick: handleCardClick, className: 'cursor-pointer' } : { to: `/product/${product.id}` };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.05 }}
    >
      <Wrapper {...wrapperProps}>
        <div className={`rounded-lg border bg-card text-card-foreground shadow-sm glass-card border-0 text-white overflow-hidden group transition-all duration-300 ${isUnavailable ? 'opacity-75 grayscale-[0.5]' : 'hover:shadow-2xl hover:-translate-y-1'}`}>
          <div className="relative">
            <img
              src={product.image ||placeholderImage}
              alt={product.title}
              className="w-full h-64 object-cover transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-all duration-300" />
            
            {isUnavailable && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
                <div className="bg-red-500/90 text-white font-bold px-4 py-2 rounded-full shadow-lg flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" /> Temporarily Unavailable
                </div>
              </div>
            )}

            {!isUnavailable && product.ribbon_text && (
              <div className="absolute top-3 left-3 bg-pink-500/90 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg z-0">
                {product.ribbon_text}
              </div>
            )}
            
            {!isUnavailable && (
              <div className="absolute top-3 right-3 bg-purple-500/80 text-white text-xs font-bold px-3 py-1 rounded-full flex items-baseline gap-1.5 z-0">
                {hasSale && (
                  <span className="line-through opacity-70">{originalPrice}</span>
                )}
                <span>{displayPrice}</span>
              </div>
            )}
          </div>
          <div className="p-4 relative z-0">
            <h3 className="text-lg font-bold truncate">{product.title}</h3>
            <p className="text-sm text-gray-300 h-10 overflow-hidden">{product.subtitle || 'Check out this amazing product!'}</p>
            <Button 
              onClick={handleAddToCart} 
              disabled={isUnavailable}
              variant={isUnavailable ? "outline" : "default"}
              className={`w-full mt-4 font-semibold ${isUnavailable ? 'bg-gray-800 text-gray-400 border-gray-600' : 'bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white'}`}
            >
              <ShoppingCart className="mr-2 h-4 w-4" /> {isUnavailable ? 'Unavailable' : 'Add to Cart'}
            </Button>
          </div>
        </div>
      </Wrapper>
    </motion.div>
  );
};

const ProductsList = () => {
  const [products, setProducts] = useState([]);
  const [unavailableServiceIds, setUnavailableServiceIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUnavailableService, setSelectedUnavailableService] = useState('');

  useEffect(() => {
    const fetchProductsAndAvailability = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch today's availability overrides
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const { data: availData } = await supabase
          .from('date_specific_availability')
          .select('service_id, is_available')
          .eq('date', todayStr)
          .eq('is_available', false);

        if (availData) {
           setUnavailableServiceIds(availData.map(a => a.service_id.toString()));
        }

        const productsResponse = await getProducts();

        if (productsResponse.products.length === 0) {
          setProducts([]);
          return;
        }

        const productIds = productsResponse.products.map(product => product.id);

        const quantitiesResponse = await getProductQuantities({
          fields: 'inventory_quantity',
          product_ids: productIds
        });

        const variantQuantityMap = new Map();
        quantitiesResponse.variants.forEach(variant => {
          variantQuantityMap.set(variant.id, variant.inventory_quantity);
        });

        const productsWithQuantities = productsResponse.products.map(product => ({
          ...product,
          variants: product.variants.map(variant => ({
            ...variant,
            inventory_quantity: variantQuantityMap.get(variant.id) ?? variant.inventory_quantity
          }))
        }));

        setProducts(productsWithQuantities);
      } catch (err) {
        setError(err.message || 'Failed to load products');
      } finally {
        setLoading(false);
      }
    };

    fetchProductsAndAvailability();
  }, []);

  const handleUnavailableClick = (serviceName) => {
    setSelectedUnavailableService(serviceName);
    setIsModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-16 w-16 text-white animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-400 p-8">
        <p>Error loading products: {error}</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center text-gray-400 p-8">
        <p>No products available at the moment.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {products.map((product, index) => {
           // Basic mapping assumption: product.id strings might match service_ids loosely 
           // In a full system this would use a proper association field, but we'll use ID matching for now
           const isUnavailable = unavailableServiceIds.includes(product.id.toString());
           return (
              <ProductCard 
                key={product.id} 
                product={product} 
                index={index} 
                isUnavailable={isUnavailable}
                onUnavailableClick={handleUnavailableClick}
              />
           );
        })}
      </div>
      
      <UnavailableServiceModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        serviceName={selectedUnavailableService}
      />
    </>
  );
};

export default ProductsList;
