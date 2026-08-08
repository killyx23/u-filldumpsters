import React from 'react';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const scrollWindowToTop = () => {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
};

const ScrollToTop = () => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    scrollWindowToTop();
    const frameId = window.requestAnimationFrame(() => {
      scrollWindowToTop();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [pathname, search]);

  return null;
};

export default ScrollToTop;
export { ScrollToTop };
