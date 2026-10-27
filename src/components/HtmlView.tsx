'use client';

import { useMemo } from 'react';
import { toDisplayHtml } from '@/lib/sanitize';

export function HtmlView({ html }: { html: string }) {
  const clean = useMemo(() => toDisplayHtml(html), [html]);
  if (!clean) return <p className="muted">No description</p>;
  return <div className="html-view" dangerouslySetInnerHTML={{ __html: clean }} />;
}
