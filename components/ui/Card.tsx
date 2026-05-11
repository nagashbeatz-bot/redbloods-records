"use client";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
}

export default function Card({ children, className = "", onClick, hover = false }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border p-4 ${hover ? "cursor-pointer" : ""} ${className}`}
      style={{
        background: "#1A1A1A",
        borderColor: "#2A2A2A",
        ...(hover ? { transition: "border-color 0.2s, background 0.2s" } : {}),
      }}
      onMouseEnter={hover ? (e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#3B82F6";
        (e.currentTarget as HTMLDivElement).style.background = "#1E1E1E";
      } : undefined}
      onMouseLeave={hover ? (e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#2A2A2A";
        (e.currentTarget as HTMLDivElement).style.background = "#1A1A1A";
      } : undefined}
    >
      {children}
    </div>
  );
}
