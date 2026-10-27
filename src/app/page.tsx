'use client';

import dynamic from 'next/dynamic';

const CalendarApp = dynamic(() => import('@/components/CalendarApp').then((m) => m.CalendarApp), { ssr: false });

export default function Page() {
  return <CalendarApp />;
}
