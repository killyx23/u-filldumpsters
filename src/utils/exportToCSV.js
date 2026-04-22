
/**
 * Export data to CSV file
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Name of the file to download
 * @param {Array} columns - Optional array of column configurations
 */
export const exportToCSV = (data, filename, columns = null) => {
  if (!data || data.length === 0) {
    console.warn('No data to export');
    return;
  }

  // Determine columns
  const headers = columns 
    ? columns.map(col => col.header || col.key)
    : Object.keys(data[0]);

  const keys = columns
    ? columns.map(col => col.key)
    : Object.keys(data[0]);

  // Create CSV content
  const csvContent = [
    headers.join(','), // Header row
    ...data.map(row => 
      keys.map(key => {
        const value = row[key];
        // Handle null/undefined
        if (value === null || value === undefined) return '';
        // Escape commas and quotes
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Export table data to CSV with formatting
 * @param {Array} data - Data array
 * @param {string} filename - Filename
 * @param {Object} options - Export options
 */
export const exportTableToCSV = (data, filename, options = {}) => {
  const {
    includeHeaders = true,
    dateFormat = 'MM/DD/YYYY',
    currencyFormat = true
  } = options;

  const formattedData = data.map(row => {
    const formatted = { ...row };
    
    // Format dates
    Object.keys(formatted).forEach(key => {
      const value = formatted[key];
      
      // Check if it's a date
      if (value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)))) {
        try {
          const date = new Date(value);
          formatted[key] = date.toLocaleDateString('en-US');
        } catch (e) {
          // Keep original value if parsing fails
        }
      }
      
      // Format currency if column name suggests it
      if (currencyFormat && (key.includes('price') || key.includes('amount') || key.includes('cost'))) {
        if (typeof value === 'number') {
          formatted[key] = value.toFixed(2);
        }
      }
    });
    
    return formatted;
  });

  exportToCSV(formattedData, filename);
};
