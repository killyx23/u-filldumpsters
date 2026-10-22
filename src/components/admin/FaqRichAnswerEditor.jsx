import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow } from '@tiptap/extension-table';
import EmojiPicker from 'emoji-picker-react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Columns,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Smile,
  Table as TableIcon,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { answerToEditorHtml } from '@/utils/faqAnswer';
import {
  CELL_COLORS,
  COMPARISON_TABLE_HTML,
  FONT_SIZES,
  FaqTableCell,
  FaqTableHeader,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from '@/components/admin/faqEditorExtensions';

const ToolButton = ({ active, disabled, label, onClick, children }) => (
  <Button
    type="button"
    size="sm"
    variant="ghost"
    disabled={disabled}
    aria-label={label}
    aria-pressed={active}
    onClick={onClick}
    className={`h-8 px-2 text-slate-800 hover:bg-slate-200 ${active ? 'bg-yellow-300 text-slate-900' : ''}`}
  >
    {children}
  </Button>
);

const ColorSelect = ({ label, value, options, onChange, disabled }) => (
  <label className="inline-flex items-center gap-1 text-xs text-slate-600">
    <span className="sr-only">{label}</span>
    <select
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 disabled:opacity-50"
    >
      {options.map((option) => (
        <option key={option.label} value={option.value}>
          {option.label === 'None' || option.label === 'Default' || option.label === 'Normal'
            ? `${label}: ${option.label}`
            : option.label}
        </option>
      ))}
    </select>
  </label>
);

export const FaqRichAnswerEditor = ({ sessionKey, value, onChange }) => {
  const valueRef = useRef(value);
  valueRef.current = value;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph'] }),
      Table.configure({ resizable: false }),
      TableRow,
      FaqTableHeader,
      FaqTableCell,
    ],
    content: answerToEditorHtml(value),
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    editorProps: {
      attributes: {
        class: 'faq-editor-content',
        'aria-label': 'FAQ answer',
      },
    },
  });

  useEffect(() => {
    if (!editor || !sessionKey) return;
    editor.commands.setContent(answerToEditorHtml(valueRef.current), { emitUpdate: false });
  }, [editor, sessionKey]);

  if (!editor) return null;

  const inTable = editor.isActive('table');
  const currentSize = editor.getAttributes('textStyle').fontSize || '';
  const currentColor = editor.getAttributes('textStyle').color || '';
  const currentHighlight = editor.getAttributes('highlight').color || '';
  const currentCell = editor.getAttributes('tableCell').backgroundColor
    || editor.getAttributes('tableHeader').backgroundColor
    || '';

  const setLink = () => {
    const previous = editor.getAttributes('link').href || 'https://';
    const url = window.prompt('Link address', previous);
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="faq-editor rounded-md border border-white/20 bg-white text-slate-900">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-2">
        <ToolButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-4 w-4" />
        </ToolButton>
        <ColorSelect
          label="Size"
          value={currentSize}
          options={FONT_SIZES}
          onChange={(size) => {
            if (!size) editor.chain().focus().unsetFontSize().run();
            else editor.chain().focus().setFontSize(size).run();
          }}
        />
        <ColorSelect
          label="Color"
          value={currentColor}
          options={TEXT_COLORS}
          onChange={(color) => {
            if (!color) editor.chain().focus().unsetColor().run();
            else editor.chain().focus().setColor(color).run();
          }}
        />
        <ColorSelect
          label="Highlight"
          value={currentHighlight}
          options={HIGHLIGHT_COLORS}
          onChange={(color) => {
            if (!color) editor.chain().focus().unsetHighlight().run();
            else editor.chain().focus().setHighlight({ color }).run();
          }}
        />
        <ToolButton label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          <AlignLeft className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          <AlignCenter className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          <AlignRight className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Link" active={editor.isActive('link')} onClick={setLink}>
          <LinkIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Insert comparison table" onClick={() => editor.chain().focus().insertContent(COMPARISON_TABLE_HTML).run()}>
          <Columns className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Add row" disabled={!inTable} onClick={() => editor.chain().focus().addRowAfter().run()}>
          Row+
        </ToolButton>
        <ToolButton label="Remove row" disabled={!inTable} onClick={() => editor.chain().focus().deleteRow().run()}>
          Row-
        </ToolButton>
        <ToolButton label="Add column" disabled={!inTable} onClick={() => editor.chain().focus().addColumnAfter().run()}>
          Col+
        </ToolButton>
        <ToolButton label="Remove column" disabled={!inTable} onClick={() => editor.chain().focus().deleteColumn().run()}>
          Col-
        </ToolButton>
        <ToolButton label="Header row" disabled={!inTable} active={editor.isActive('tableHeader')} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
          Header
        </ToolButton>
        <ToolButton label="Delete table" disabled={!inTable} onClick={() => editor.chain().focus().deleteTable().run()}>
          Delete table
        </ToolButton>
        <ColorSelect
          label="Cell"
          disabled={!inTable}
          value={currentCell}
          options={CELL_COLORS}
          onChange={(color) => {
            editor.chain().focus().setCellAttribute('backgroundColor', color || null).run();
          }}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" aria-label="Insert emoji" className="h-8 px-2 text-slate-800 hover:bg-slate-200">
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-0 bg-transparent">
            <EmojiPicker
              theme="dark"
              onEmojiClick={(emojiObject) => {
                editor.chain().focus().insertContent(emojiObject.emoji).run();
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};
