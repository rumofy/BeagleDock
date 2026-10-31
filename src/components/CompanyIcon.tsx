import type { FC } from "react";
interface CompanyIconProps {
  id: "claude" | "codex" | "antigravity" | "openrouter";
  size?: number;
  className?: string;
}
const icons = {
  claude: "claude.svg",
  codex: "openai.png",
  antigravity: "antigravity.svg",
};
export const CompanyIcon: FC<CompanyIconProps> = ({
  id,
  size = 20,
  className = "",
}) => {
  if (id === "openrouter") return null;
  return (
    <img
      src={`${import.meta.env.BASE_URL}providers/${icons[id]}`}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", flexShrink: 0 }}
      alt=""
      aria-hidden="true"
    />
  );
};
