"use client";

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}

const variants = {
  primary: {
    background: "#3B82F6",
    color: "#fff",
    border: "transparent",
    hover: "#2563EB",
  },
  secondary: {
    background: "#1A1A1A",
    color: "#F0F0F0",
    border: "#2A2A2A",
    hover: "#222",
  },
  danger: {
    background: "rgba(239,68,68,0.15)",
    color: "#EF4444",
    border: "#EF444440",
    hover: "rgba(239,68,68,0.25)",
  },
  ghost: {
    background: "transparent",
    color: "#888",
    border: "transparent",
    hover: "#1A1A1A",
  },
};

export default function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled,
  type = "button",
  className = "",
}: ButtonProps) {
  const v = variants[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border font-medium transition-all ${
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      style={{ background: v.background, color: v.color, borderColor: v.border }}
      onMouseEnter={!disabled ? (e) => {
        (e.currentTarget as HTMLButtonElement).style.background = v.hover;
      } : undefined}
      onMouseLeave={!disabled ? (e) => {
        (e.currentTarget as HTMLButtonElement).style.background = v.background;
      } : undefined}
    >
      {children}
    </button>
  );
}
