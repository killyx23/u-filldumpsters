import { TableCell, TableHeader } from '@tiptap/extension-table';

function withCellBackground(Base) {
  return Base.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        backgroundColor: {
          default: null,
          parseHTML: (element) => element.style.backgroundColor || null,
          renderHTML: (attributes) => {
            if (!attributes.backgroundColor) return {};
            return { style: `background-color: ${attributes.backgroundColor}` };
          },
        },
      };
    },
  });
}

export const FaqTableCell = withCellBackground(TableCell);
export const FaqTableHeader = withCellBackground(TableHeader);

export const COMPARISON_TABLE_HTML = [
  '<table><tbody>',
  '<tr><th><p>Feature / Benefit</p></th><th><p>Option A</p></th><th><p>Option B</p></th></tr>',
  '<tr><td><p>Row title</p></td><td><p></p></td><td><p></p></td></tr>',
  '<tr><td><p>Row title</p></td><td><p></p></td><td><p></p></td></tr>',
  '</tbody></table>',
].join('');

export const FONT_SIZES = [
  { label: 'Small', value: '0.875rem' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '1.25rem' },
  { label: 'Extra large', value: '1.5rem' },
];

export const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Black', value: '#0f172a' },
  { label: 'White', value: '#ffffff' },
  { label: 'Yellow', value: '#ca8a04' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Green', value: '#15803d' },
  { label: 'Blue', value: '#1d4ed8' },
  { label: 'Pink', value: '#be185d' },
];

export const HIGHLIGHT_COLORS = [
  { label: 'None', value: '' },
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Pink', value: '#fbcfe8' },
  { label: 'Green', value: '#bbf7d0' },
  { label: 'Blue', value: '#bfdbfe' },
];

export const CELL_COLORS = [
  { label: 'None', value: '' },
  { label: 'White', value: '#ffffff' },
  { label: 'Pink', value: '#fce7f3' },
  { label: 'Green', value: '#dcfce7' },
  { label: 'Yellow', value: '#fef9c3' },
  { label: 'Blue', value: '#dbeafe' },
  { label: 'Gray', value: '#f1f5f9' },
];
