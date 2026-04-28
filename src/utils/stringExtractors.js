export const safeExtractString = (val, fallback = '') => {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') {
        if (Array.isArray(val)) return val.length > 0 ? safeExtractString(val[0]) : fallback;
        return val.name || val.value || val.label || val.title || val.text || JSON.stringify(val);
    }
    return String(val);
};

export const safeExtractNumber = (val, fallback = 0) => {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') {
        if (Array.isArray(val)) return fallback;
        const num = Number(val.value || val.amount || val.price || 0);
        return isNaN(num) ? fallback : num;
    }
    const num = Number(val);
    return isNaN(num) ? fallback : num;
};