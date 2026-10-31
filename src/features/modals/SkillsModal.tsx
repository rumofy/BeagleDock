import { useState } from "react";
import {
  ChevronRight,
  X,
  Sparkle,
  Wand2,
  Search,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

export function SkillsModal() {
  const {
    showSkillsModal,
    setShowSkillsModal,
    installedSkills,
    handleSelectSkill,
  } = useApp();
  const [skillsSearch, setSkillsSearch] = useState<string>("");
  if (!showSkillsModal) return null;

  return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden max-h-[80vh]">
            <div className="p-4 border-b border-[#eeeae0] bg-[#faf8f4] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1">
                <Wand2 size={20} className="text-amber-600" />
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="absolute left-3 top-2.5 text-[#8c8270]"
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar skills salvas (ex: revisor, seguranca, memory, aws)..."
                    value={skillsSearch}
                    onChange={(e) => setSkillsSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#d6cfbe] bg-[#ffffff] text-xs outline-none focus:border-[#968d7a]"
                  />
                </div>
              </div>
              <span className="font-mono text-[10px] bg-[#ede9de] px-2 py-1 rounded text-[#6b6251]">
                ESC para fechar
              </span>
              <button
                onClick={() => setShowSkillsModal(false)}
                className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>
                  Skills reais instaladas no seu ambiente (
                  {installedSkills.length})
                </span>
                <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Clique para chamar a skill
                </span>
              </div>

              {installedSkills
                .filter(
                  (s) =>
                    s.name.toLowerCase().includes(skillsSearch.toLowerCase()) ||
                    s.description
                      .toLowerCase()
                      .includes(skillsSearch.toLowerCase()) ||
                    (s.category &&
                      s.category
                        .toLowerCase()
                        .includes(skillsSearch.toLowerCase())),
                )
                .map((skill) => (
                  <div
                    key={skill.id}
                    onClick={() => handleSelectSkill(skill)}
                    className="group p-3 rounded-xl border border-[#ded8cb] hover:border-[#968d7a] hover:bg-[#fbf9f5] transition cursor-pointer flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#1c1b18] group-hover:text-amber-700 flex items-center gap-1.5">
                          <Sparkle size={13} className="text-amber-600" />
                          {skill.name}
                        </span>
                        {skill.category && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-[#ece7db] text-[#5c5446]">
                            {skill.category}
                          </span>
                        )}
                        {skill.name.includes("revis") && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Revisor Favorito
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6e6656] line-clamp-2 leading-relaxed">
                        {skill.description}
                      </p>
                      <div className="pt-1 flex items-center gap-2 text-[10px] font-mono text-[#8c8270]">
                        <span className="truncate max-w-md">{skill.path}</span>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <span className="px-2 py-1 rounded-lg bg-[#ede9de] group-hover:bg-amber-100 group-hover:text-amber-900 font-mono text-[10px] font-bold text-[#443e33] transition flex items-center gap-1">
                        <span>Chamar</span>
                        <ChevronRight size={12} />
                      </span>
                    </div>
                  </div>
                ))}
            </div>

            <div className="p-3 bg-[#faf8f4] border-t border-[#eeeae0] text-center text-xs text-[#7d7565]">
              Atalho global: pressione{" "}
              <kbd className="font-bold bg-[#ede9de] px-1.5 py-0.5 rounded text-[#332f28]">
                Ctrl + K
              </kbd>{" "}
              a qualquer momento no cockpit.
            </div>
          </div>
        </div>
  );
}
