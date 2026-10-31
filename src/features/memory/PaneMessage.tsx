export function PaneMessage({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`m-3 p-3 rounded-xl text-xs border ${tone === "error" ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-[#f4f1e8] border-[#e6e1d5] text-[#6d6657]"}`}
    >
      {children}
    </div>
  );
}
