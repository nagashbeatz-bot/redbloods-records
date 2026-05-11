import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 512,
          height: 512,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0D0D0D",
          borderRadius: 102,
        }}
      >
        {/* Red circle */}
        <div
          style={{
            width: 300,
            height: 300,
            borderRadius: "50%",
            background: "#EF4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              color: "#FFFFFF",
              fontSize: 180,
              fontWeight: 800,
              lineHeight: 1,
              marginTop: 10,
            }}
          >
            R
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
