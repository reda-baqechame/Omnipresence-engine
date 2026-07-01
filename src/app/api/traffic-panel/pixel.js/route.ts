/**
 * Opt-in traffic panel pixel — embed on client sites to feed Layer 2 panel observations.
 * GET /api/traffic-panel/pixel.js?projectId=...&domain=...
 */
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") || "";
  const domain = req.nextUrl.searchParams.get("domain") || "";
  const base = process.env.NEXT_PUBLIC_APP_URL || "";

  const script = `
(function(){
  var pid=${JSON.stringify(projectId)};
  var dom=${JSON.stringify(domain)};
  if(!pid||!dom)return;
  try{
    var k='presenceos_pv_'+pid;
    if(sessionStorage.getItem(k))return;
    sessionStorage.setItem(k,'1');
    var img=new Image();
    img.src=${JSON.stringify(base)}+'/api/traffic-panel/beacon?projectId='+encodeURIComponent(pid)+'&domain='+encodeURIComponent(dom)+'&t='+Date.now();
  }catch(e){}
})();
`.trim();

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
