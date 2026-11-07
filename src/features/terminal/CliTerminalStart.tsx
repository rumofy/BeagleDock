import { Terminal } from "lucide-react";
import { t } from "../../i18n";

/** A new conversation stays editable until the person starts its CLI from the header. */
export function CliTerminalStart() {
  return (
    <div data-testid="cli-terminal-start" className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center text-[#7d7565]">
      <Terminal size={32} />
      <p className="font-semibold">{t("terminal.chooseWorkspace")}</p>
      <p className="text-sm max-w-lg">{t("terminal.startHint")}</p>
    </div>
  );
}
