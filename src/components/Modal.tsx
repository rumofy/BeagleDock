import { X } from "lucide-react";

import { t } from "../i18n";
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div
        role="dialog"
        aria-label={title}
        className={`bg-white border border-[#d8d2c3] rounded-2xl shadow-2xl w-full ${wide ? "max-w-xl" : "max-w-md"} max-h-[90vh] overflow-y-auto p-5 space-y-4`}
      >
        <div className="flex items-center justify-between pb-2 border-b border-[#eeeae0]">
          <h3 className="font-bold text-base text-[#1c1b18]">{title}</h3>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
