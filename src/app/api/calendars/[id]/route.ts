import { getRepo } from '@/lib/db';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { shown?: unknown; color?: unknown };
  const hasShown = 'shown' in body;
  const hasColor = 'color' in body;
  if (!hasShown && !hasColor) return Response.json({ error: 'nothing to change' }, { status: 400 });
  if (hasShown && typeof body.shown !== 'boolean') return Response.json({ error: 'shown must be a boolean' }, { status: 400 });
  if (hasColor && body.color !== null && !(typeof body.color === 'string' && HEX_COLOR.test(body.color))) {
    return Response.json({ error: 'color must be #rrggbb or null' }, { status: 400 });
  }

  const repo = getRepo();
  if (hasShown) repo.setShown(Number(id), body.shown as boolean);
  if (hasColor) repo.setColorOverride(Number(id), body.color as string | null);
  return new Response(null, { status: 204 });
}
