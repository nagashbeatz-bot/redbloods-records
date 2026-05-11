export function SkeletonLine({
  width = "100%",
  height = 14,
}: {
  width?: string | number;
  height?: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        background: "#1E1E1E",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, transparent 0%, #2A2A2A 50%, transparent 100%)",
          animation: "skeleton-sweep 1.6s ease-in-out infinite",
        }}
      />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div
      style={{
        background: "#1A1A1A",
        border: "1px solid #222",
        borderRadius: 14,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <SkeletonLine width="55%" height={13} />
        <SkeletonLine width="35%" height={11} />
      </div>
      <SkeletonLine width={64} height={22} />
    </div>
  );
}

export function SkeletonSection() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div
          style={{ width: 6, height: 16, borderRadius: 4, background: "#252525" }}
        />
        <SkeletonLine width={80} height={13} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
