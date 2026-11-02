import { CliSettingsCard } from "./CliSettingsCard";
import { ApiKeysCard } from "./ApiKeysCard";
import { AppearanceCard } from "./AppearanceCard";
import { BackgroundCard } from "./BackgroundCard";
import { AutoCompactCard } from "./AutoCompactCard";
import { NewChatDefaultsCard } from "./NewChatDefaultsCard";
import { VoiceDictationCard } from "./VoiceDictationCard";

export function SettingsTab() {
  return (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl w-full mx-auto space-y-6">
                <AppearanceCard />
                <BackgroundCard />
                <NewChatDefaultsCard />
                <AutoCompactCard />
                <VoiceDictationCard />
                <CliSettingsCard />
                <ApiKeysCard />
              </div>
            </div>
  );
}
