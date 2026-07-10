export async function GET() {
  return Response.json({ status: "ok", service: "tf-news", timestamp: new Date().toISOString() });
}

