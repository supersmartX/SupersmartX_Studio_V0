import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: 'Gone: raw recording upload retired. Use export flow.' }, { status: 410 });
}
