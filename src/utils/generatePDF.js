/**
 * Generate PDF from HTML content
 * Note: This is a basic implementation. For production, consider using jsPDF with html2canvas
 * or react-pdf for more control over layout
 */

/**
 * Print current page as PDF using browser's print dialog
 * @param {string} title - Document title
 */
export const printAsPDF = (title = 'Document') => {
  document.title = title;
  window.print();
};

/**
 * Generate PDF from a specific element
 * @param {HTMLElement} element - Element to convert to PDF
 * @param {string} filename - PDF filename
 */
export const generatePDFFromElement = async (element, filename) => {
  if (!element) {
    console.error('Element not found for PDF generation');
    return;
  }

  // Create a print-friendly version
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    console.error('Could not open print window');
    return;
  }

  // Clone the element
  const clone = element.cloneNode(true);
  
  // Add print styles
  const styles = `
    <style>
      @media print {
        body { margin: 0; padding: 20px; }
        @page { size: auto; margin: 0.5in; }
      }
      body { font-family: Arial, sans-serif; }
      table { border-collapse: collapse; width: 100%; margin: 20px 0; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; font-weight: bold; }
      .no-print { display: none; }
    </style>
  `;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${filename}</title>
        ${styles}
      </head>
      <body>
        ${clone.innerHTML}
      </body>
    </html>
  `);
  
  printWindow.document.close();
  
  // Wait for content to load, then print
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
};

/**
 * Create a printable report layout
 * @param {Object} reportData - Report data object
 * @returns {string} HTML string for PDF
 */
export const createReportHTML = (reportData) => {
  const { title, dateRange, sections, summary } = reportData;
  
  let html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h1 style="color: #1a202c; border-bottom: 3px solid #eab308; padding-bottom: 10px;">
        ${title}
      </h1>
      <p style="color: #666; margin: 10px 0;">
        <strong>Date Range:</strong> ${dateRange}
      </p>
  `;

  // Add sections
  if (sections && sections.length > 0) {
    sections.forEach(section => {
      html += `
        <div style="margin: 30px 0;">
          <h2 style="color: #2d3748; border-left: 4px solid #eab308; padding-left: 10px;">
            ${section.title}
          </h2>
      `;

      if (section.table) {
        html += `
          <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
            <thead>
              <tr style="background-color: #f7fafc;">
                ${section.table.headers.map(h => `<th style="border: 1px solid #e2e8f0; padding: 10px; text-align: left;">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${section.table.rows.map(row => `
                <tr>
                  ${row.map(cell => `<td style="border: 1px solid #e2e8f0; padding: 10px;">${cell}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }

      if (section.content) {
        html += `<div style="margin: 15px 0;">${section.content}</div>`;
      }

      html += `</div>`;
    });
  }

  // Add summary
  if (summary) {
    html += `
      <div style="margin-top: 40px; padding: 20px; background-color: #f7fafc; border-left: 4px solid #eab308;">
        <h3 style="margin-top: 0;">Summary</h3>
        ${summary}
      </div>
    `;
  }

  html += `
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 12px;">
        <p>Generated on ${new Date().toLocaleString()}</p>
      </div>
    </div>
  `;

  return html;
};