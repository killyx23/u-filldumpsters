
import React from 'react';
import { AIAssistant } from './AIAssistant';

/**
 * Wrapper component for AI Assistant integration into Communication Hub
 */
export const AIAssistantTab = ({ customer }) => {
  return (
    <div className="ai-assistant-tab-wrapper">
      <AIAssistant customer={customer} />
    </div>
  );
};
