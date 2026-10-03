import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const WIDGET_ID = '68be522405d0a80e98094c7c';
const SCRIPT_SRC = 'https://conversations-widget.brevo.com/brevo-conversations.js';
const SCRIPT_ID = 'brevo-conversations-widget';

const CHAT_PATHS = new Set(['/', '/payment', '/verify-email']);

const normalizePath = (pathname) => {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
};

const isChatPath = (pathname) => CHAT_PATHS.has(normalizePath(pathname));

const ensureWidgetStub = () => {
  window.BrevoConversationsID = WIDGET_ID;
  window.BrevoConversationsSetup = {
    ...(window.BrevoConversationsSetup || {}),
    startHidden: true,
    disableChatOpenHash: true,
  };

  if (typeof window.BrevoConversations !== 'function') {
    const queued = function brevoConversations() {
      (queued.q = queued.q || []).push(arguments);
    };
    window.BrevoConversations = queued;
  }
};

const loadWidgetScript = () => {
  if (document.getElementById(SCRIPT_ID)) return;
  ensureWidgetStub();
  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = SCRIPT_SRC;
  document.head.appendChild(script);
};

export const BrevoChat = () => {
  const { pathname } = useLocation();
  const visible = isChatPath(pathname);

  useEffect(() => {
    const widgetLoaded = Boolean(document.getElementById(SCRIPT_ID));

    if (!visible) {
      if (widgetLoaded && typeof window.BrevoConversations === 'function') {
        window.BrevoConversations('hide');
      }
      return;
    }

    loadWidgetScript();
    window.BrevoConversations('show');
    window.BrevoConversations('pageView');
  }, [pathname, visible]);

  return null;
};
