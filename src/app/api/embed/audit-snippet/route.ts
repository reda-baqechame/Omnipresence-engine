import { NextResponse } from "next/server";

/** Public embed snippet for agency white-label audit widgets. */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app";
  const snippet = `<!-- OmniPresence Embed Audit -->
<div id="omnipresence-audit"></div>
<script>
(function(){
  var f=document.createElement("iframe");
  f.src="${base}/embed/audit";
  f.style.cssText="width:100%;min-height:520px;border:0;border-radius:12px";
  f.title="OmniPresence Audit";
  document.getElementById("omnipresence-audit").appendChild(f);
})();
</script>`;

  return new NextResponse(snippet, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
