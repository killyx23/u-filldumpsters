import React from 'react';

export const EditInput = ({ label, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-blue-200 mb-1">{label}</label>
        <input {...props} className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 px-3 py-2" />
    </div>
);