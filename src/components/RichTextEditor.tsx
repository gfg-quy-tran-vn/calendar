'use client';

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';

type Props = { value: string; onChange: (html: string) => void };

function setLink(editor: Editor) {
  const url = window.prompt('Link URL (empty to remove)', editor.getAttributes('link').href ?? 'https://');
  if (url === null) return;
  const chain = editor.chain().focus().extendMarkRange('link');
  if (url === '') chain.unsetLink().run();
  else chain.setLink({ href: url }).run();
}

export function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), TableKit],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;

  const tools: [string, () => void][] = [
    ['B', () => editor.chain().focus().toggleBold().run()],
    ['I', () => editor.chain().focus().toggleItalic().run()],
    ['U', () => editor.chain().focus().toggleUnderline().run()],
    ['H', () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
    ['• List', () => editor.chain().focus().toggleBulletList().run()],
    ['1. List', () => editor.chain().focus().toggleOrderedList().run()],
    ['Link', () => setLink(editor)],
    ['Table', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
  ];

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {tools.map(([label, action]) => (
          <button key={label} type="button" onMouseDown={(e) => { e.preventDefault(); action(); }}>
            {label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
