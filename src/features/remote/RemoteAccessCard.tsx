import { useEffect, useState } from "react";
import { Smartphone, Trash2 } from "lucide-react";
import { beagleApi, remoteAccessAvailable } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { useNow } from "../../hooks/useNow";
import type { RemoteAccessStatus, RemotePairing } from "../../types/api";
import { t } from "../../i18n";

/** Phone access over the local network: turn it on, pair a phone with a QR code and revoke devices. */
export function RemoteAccessCard() {
  const { setAppError } = useApp();
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useState("");
  // Revoking takes a second click on the same device.
  const [armed, setArmed] = useState<string | null>(null);
  const now = useNow(!!pairing);

  useEffect(() => {
    if (!remoteAccessAvailable()) return;
    void beagleApi.getRemoteAccessStatus().then(setStatus).catch(() => {});
    return beagleApi.on("remote-access-status", (next) => {
      setStatus(next);
      // Paired (or the code ran out of attempts): the code on screen is no longer valid.
      if (!next.pairing) setPairing(null);
    });
  }, []);
  const expired = pairing && pairing.expiresAt <= now;
  useEffect(() => {
    if (expired) setPairing(null);
  }, [expired]);
  useEffect(() => {
    if (status) setPort(String(status.port));
  }, [status?.port]);

  if (!remoteAccessAvailable() || !status) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (enabled: boolean) =>
    run(async () => {
      setPairing(null);
      setStatus(await beagleApi.setRemoteAccessEnabled(enabled));
    });
  const pair = () => run(async () => setPairing(await beagleApi.startRemotePairing()));
  const validPort = /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
  const applyPort = () => run(async () => {
    setPairing(null);
    setStatus(await beagleApi.setRemoteAccessPort(Number(port)));
  });
  const cancel = () =>
    run(async () => {
      await beagleApi.cancelRemotePairing();
      setPairing(null);
    });
  const revoke = (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    void run(() => beagleApi.revokeRemoteDevice(id));
  };
  const seconds = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1 flex items-center gap-2">
        <Smartphone size={18} /> {t("remote.title")}
      </h2>
      <p className="text-xs text-[#7d7565] mb-5">{t("remote.intro")}</p>
      <label className="flex items-start gap-3 text-sm text-[#2c2822]">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-1"
        />
        <span>
          {t("remote.enable")}
          <span className="block text-xs text-[#7d7565]">{t("remote.enableHint")}</span>
        </span>
      </label>

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && validPort) void applyPort();
        }}
      >
        <label htmlFor="remote-access-port" className="block text-sm text-[#2c2822] mb-2">
          {t("remote.portLabel")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="remote-access-port"
            type="number"
            min={1}
            max={65535}
            step={1}
            required
            value={port}
            disabled={busy}
            onChange={(event) => setPort(event.target.value)}
            aria-describedby="remote-access-port-hint"
            aria-invalid={!validPort}
            className="w-28 border border-[#d6cfbe] rounded-lg bg-[#ffffff] px-3 py-2 text-sm text-[#2c2822]"
          />
          <button
            type="submit"
            disabled={busy || !validPort || (Number(port) === status.port && !status.error)}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-[#1c1b18] text-white hover:bg-[#2c2822] disabled:opacity-50"
          >
            {t("remote.applyPort")}
          </button>
        </div>
        <p id="remote-access-port-hint" className="mt-2 text-xs text-[#7d7565]">
          {t("remote.portHint")}
        </p>
        {!validPort && <p role="alert" className="mt-2 text-xs text-rose-700">{t("remote.invalidPort")}</p>}
      </form>

      {status.error && (
        <p className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {status.error}
        </p>
      )}
      {status.enabled && status.running && !status.encryptedKeys && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {t("remote.keysNotEncrypted")}
        </p>
      )}

      {status.running && (
        <div className="mt-5 space-y-4">
          <div className="text-xs text-[#443e33]">
            <div className="font-semibold mb-1">{t("remote.addresses")}</div>
            {status.urls.length ? (
              <ul className="font-mono space-y-0.5">
                {status.urls.map((url) => (
                  <li key={url}>{url}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[#7d7565]">{t("remote.noNetwork")}</p>
            )}
            {status.certificateFingerprint && (
              <p className="mt-2 text-[#7d7565] break-all">
                {t("remote.fingerprint")}{" "}
                <span className="font-mono">{status.certificateFingerprint}</span>
              </p>
            )}
          </div>

          {pairing ? (
            <div className="border border-[#ded8cb] rounded-xl p-4 flex gap-5 items-start">
              <img
                src={pairing.qrDataUrl}
                alt={t("remote.qrAlt")}
                className="w-44 h-44 shrink-0 [image-rendering:pixelated] rounded-lg border border-[#ded8cb]"
              />
              <div className="text-xs text-[#443e33] space-y-2">
                <p className="font-semibold">{t("remote.pairTitle")}</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>{t("remote.step1")}</li>
                  <li>{t("remote.step2")}</li>
                  <li>{t("remote.step3")}</li>
                  <li>{t("remote.step4")}</li>
                </ol>
                <p>
                  {t("remote.codeLabel")}{" "}
                  <span className="font-mono text-base font-bold tracking-widest text-[#1c1b18]">
                    {pairing.code.slice(0, 4)}-{pairing.code.slice(4)}
                  </span>
                </p>
                <p className="text-[#7d7565]">{t("remote.expiresIn", { seconds })}</p>
                <button
                  type="button"
                  onClick={() => void cancel()}
                  className="px-3 py-1.5 rounded-lg border border-[#d6cfbe] bg-[#ede9de] font-bold hover:bg-[#e2dcce]"
                >
                  {t("remote.cancelPairing")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !status.urls.length}
              onClick={() => void pair()}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-[#1c1b18] text-white hover:bg-[#2c2822] disabled:opacity-50"
            >
              {t("remote.pairButton")}
            </button>
          )}

          <div>
            <div className="text-xs font-semibold text-[#443e33] mb-1">{t("remote.devices")}</div>
            {status.devices.length ? (
              <ul className="divide-y divide-[#ede9de] border border-[#ede9de] rounded-lg">
                {status.devices.map((device) => (
                  <li key={device.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <Smartphone size={14} className="text-[#7d7565]" />
                    <span className="flex-1">
                      <span className="font-semibold text-[#1c1b18]">{device.name}</span>
                      <span className="block text-[#7d7565]">
                        {t("remote.deviceSeen", { paired: date(device.createdAt), seen: date(device.lastSeenAt) })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => revoke(device.id)}
                      onBlur={() => setArmed((current) => (current === device.id ? null : current))}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-rose-800 hover:bg-rose-50 font-bold"
                    >
                      <Trash2 size={12} />{" "}
                      {armed === device.id ? t("remote.revokeConfirm") : t("remote.revoke")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#7d7565]">{t("remote.noDevices")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
