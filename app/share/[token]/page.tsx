import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{ token: string }>;
}

async function getShareData(token: string) {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", `share_token_${token}`)
    .single();

  if (error || !data) return null;

  const val = data.value as {
    dropboxPath: string;
    fileName: string;
    createdAt: string;
  };

  // Get a fresh temporary Dropbox link
  let dropboxToken: string;
  try {
    const { getDropboxToken } = await import("@/lib/dropbox-token");
    dropboxToken = await getDropboxToken();
  } catch { return null; }

  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dropboxToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: val.dropboxPath }),
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data2 = (await res.json()) as { link: string };
  return { link: data2.link, fileName: val.fileName };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const share = await getShareData(token);

  if (!share) return notFound();

  const { link, fileName } = share;

  return (
    <html lang="he" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fileName}</title>
        <meta property="og:title" content={fileName} />
        <meta property="og:type" content="music.song" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0E0E0E;
            color: #E8E8E8;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px 16px;
          }
          .card {
            background: #1A1A1A;
            border: 1px solid #2A2A2A;
            border-radius: 20px;
            padding: 32px 24px;
            max-width: 420px;
            width: 100%;
            text-align: center;
          }
          .logo {
            font-size: 13px;
            font-weight: 700;
            color: #555;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 28px;
          }
          .logo span {
            background: linear-gradient(135deg, #EC4899, #3B82F6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .icon {
            font-size: 48px;
            margin-bottom: 16px;
          }
          .filename {
            font-size: 15px;
            font-weight: 600;
            color: #E0E0E0;
            margin-bottom: 28px;
            line-height: 1.4;
            word-break: break-word;
          }
          audio {
            width: 100%;
            border-radius: 12px;
            margin-bottom: 20px;
            accent-color: #EC4899;
          }
          .download-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 13px;
            border-radius: 12px;
            border: none;
            background: linear-gradient(135deg, #EC4899, #3B82F6);
            color: #fff;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            transition: opacity 0.15s;
          }
          .download-btn:active { opacity: 0.85; }
          .footer {
            font-size: 11px;
            color: #444;
            margin-top: 22px;
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="logo"><span>Redbloods</span> Records</div>
          <div className="icon">🎵</div>
          <div className="filename">{fileName}</div>

          {/* Native audio player — works in WhatsApp in-app browser */}
          <audio controls preload="metadata">
            <source src={link} />
          </audio>

          {/* Download button */}
          <a href={link} download={fileName} className="download-btn">
            ⬇ הורד קובץ
          </a>

          <div className="footer">קישור זה תקף ל-4 שעות</div>
        </div>
      </body>
    </html>
  );
}
