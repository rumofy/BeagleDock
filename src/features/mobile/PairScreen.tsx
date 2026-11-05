import { useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { BeagleLogo } from "../../components/BeagleLogo";
import { pair } from "./mobileClient";
import { pairingCodeFromHash, suggestedDeviceName } from "./mobileState";
import { t } from "../../i18n";

/** First screen on a new phone: trust the certificate and pair with the code shown on the desktop. */
export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState(() => pairingCodeFromHash(window.location.hash));
  const [name, setName] = useState(() => suggestedDeviceName(navigator.userAgent));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await pair(code, name.trim());
      // The code is single-use: it leaves the address so it isn't saved with the Home Screen icon.
      history.replaceState(null, "", window.location.pathname);
      onPaired();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-full px-5 py-8 max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <BeagleLogo size={40} />
        <div>
          <h1 className="font-extrabold text-xl text-[#1c1b18]">{t("mobile.pairTitle")}</h1>
          <p className="text-xs text-[#7d7565]">{t("mobile.pairIntro")}</p>
        </div>
      </div>

      <section className="bg-white border border-[#ded8cb] rounded-2xl p-4 space-y-3">
        <h2 className="font-bold text-sm flex items-center gap-2 text-[#1c1b18]">
          <ShieldCheck size={16} /> {t("mobile.trustTitle")}
        </h2>
        <ol className="list-decimal pl-5 text-xs text-[#443e33] space-y-1">
          <li>{t("mobile.trustStep1")}</li>
          <li>{t("mobile.trustStep2")}</li>
          <li>{t("mobile.trustStep3")}</li>
        </ol>
        <a
          href="/beagledock-ca.crt"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border border-[#d6cfbe] bg-[#ede9de] text-[#2c2822]"
        >
          <Download size={14} /> {t("mobile.downloadCertificate")}
        </a>
        <p className="text-[11px] text-[#7d7565]">{t("mobile.homeScreenHint")}</p>
      </section>

      <form
        className="bg-white border border-[#ded8cb] rounded-2xl p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block text-xs font-semibold text-[#443e33]">
          {t("mobile.codeLabel")}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            inputMode="text"
            placeholder="ABCD-2345"
            className="mt-1 w-full rounded-lg border border-[#d6cfbe] bg-[#fcfbfa] px-3 py-2 font-mono text-lg tracking-widest text-[#1c1b18]"
          />
        </label>
        <label className="block text-xs font-semibold text-[#443e33]">
          {t("mobile.deviceName")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className="mt-1 w-full rounded-lg border border-[#d6cfbe] bg-[#fcfbfa] px-3 py-2 text-base text-[#1c1b18]"
          />
        </label>
        {error && <p className="text-xs text-rose-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length < 8}
          className="w-full py-2.5 rounded-xl text-sm font-bold bg-[#1c1b18] text-white disabled:opacity-50"
        >
          {busy ? t("mobile.pairing") : t("mobile.pairButton")}
        </button>
      </form>
    </div>
  );
}
