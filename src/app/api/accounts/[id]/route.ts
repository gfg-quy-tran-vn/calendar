import { getRepo } from '@/lib/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getRepo().deleteAccount(Number(id));
  return new Response(null, { status: 204 });
}
