/**
 * Single source of truth for marketing / catalog images.
 * All files live under public/images/ and ship with the Vercel frontend deploy.
 * Do not hardcode external CDN URLs for these assets.
 */

export const siteImages = {
  logo: '/images/logo.webp',
  banner: '/images/banner-saratoga.png',

  /** Homepage hero service cards keyed by services.id */
  heroByServiceId: {
    1: '/images/hero-dumpster-16yd.png',
    2: '/images/hero-dump-loader.png',
    3: '/images/hero-rock-mulch-gravel.png',
    5: '/images/diy-heavy-equipment.png',
  },

  showcaseDumpster: '/images/hero-dumpster-16yd.png',

  diyHeavyEquipment: '/images/diy-heavy-equipment.png',
  miniExcavator: '/images/mini-excavator.png',
  miniTelescopingLoader: '/images/mini-telescoping-loader.png',

  gorillaCartGallery: [
    { url: '/images/gorilla-cart/01.jpg', title: 'Feature Diagram' },
    { url: '/images/gorilla-cart/02.jpg', title: 'Side View' },
    { url: '/images/gorilla-cart/03.jpg', title: 'Full Cart View' },
    { url: '/images/gorilla-cart/04.jpg', title: 'Loaded Cart' },
    { url: '/images/gorilla-cart/05.jpg', title: 'Dumping Action' },
    { url: '/images/gorilla-cart/06.jpg', title: 'Detail Shot' },
    { url: '/images/gorilla-cart/07.jpg', title: 'Frame Construction' },
    { url: '/images/gorilla-cart/08.jpg', title: 'Wheel Assembly' },
    { url: '/images/gorilla-cart/09.jpg', title: 'Handle Detail' },
    { url: '/images/gorilla-cart/10.jpg', title: 'In Use' },
  ],

  gorillaCartAddon: [
    '/images/gorilla-cart/product-main.jpg',
    '/images/gorilla-cart/product-01.jpg',
    '/images/gorilla-cart/product-02.jpg',
    '/images/gorilla-cart/product-03.jpg',
    '/images/gorilla-cart/product-04.jpg',
    '/images/gorilla-cart/product-05.jpg',
    '/images/gorilla-cart/product-06.jpg',
    '/images/gorilla-cart/product-07.jpg',
    '/images/gorilla-cart/product-08.jpg',
  ],

  handTruckAddon: [
    '/images/hand-truck/01.jpg',
    '/images/hand-truck/02.jpg',
    '/images/hand-truck/03.jpg',
    '/images/hand-truck/04.jpg',
    '/images/hand-truck/05.jpg',
    '/images/hand-truck/06.jpg',
  ],
};

/** @param {number|string|null|undefined} serviceId */
export function getHeroImageForService(serviceId) {
  return siteImages.heroByServiceId[Number(serviceId)] || '';
}
