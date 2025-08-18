import React from 'react';

export const DetailItem = ({ label, value }) => (
    <div className="flex justify-between">
        <p className="font-semibold text-blue-200">{label}:</p>
        <p className="text-right">{value}</p>
    </div>
);