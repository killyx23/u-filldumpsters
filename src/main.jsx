import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import ScrollToTop from '@/components/ScrollToTop';
import '@/index.css';

// Environment variable validation and logging
const googlePlacesKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
console.log(`[Startup Check] Google Places API Key Status: ${googlePlacesKey ? 'LOADED' : 'MISSING'}`);

if (!googlePlacesKey) {
  console.warn("⚠️ WARNING: VITE_GOOGLE_PLACES_API_KEY is missing or invalid. Address autocomplete will fallback to manual entry mode.");
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <BrowserRouter>
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </>
);