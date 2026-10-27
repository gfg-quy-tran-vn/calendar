import { getRepo } from '@/lib/db';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { shown } = (await req.json()) as { shown?: unknown };
  if (typeof shown !== 'boolean') return Response.json({ error: 'shown must be a boolean' }, { status: 400 });
  getRepo().setShown(Number(id), shown);
  return new Response(null, { status: 204 });
}
