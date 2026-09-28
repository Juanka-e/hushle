"use client";

import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import {
  ChevronRight,
  Gamepad2,
  LogOut,
  Link2,
  MailCheck,
  Music,
  Save,
  User,
  UserCog,
  Volume2,
} from "lucide-react";
import { DashboardPageShell, DashboardSection } from "@/components/game/dashboard-page-shell";
import {
  defaultDashboardSettings,
  readDashboardSettings,
  type DashboardSettingsState,
  writeDashboardSettings,
} from "@/lib/dashboard-settings";
import type { UserInventoryResponse } from "@/types/economy";
import { useI18n } from "@/components/providers/i18n-provider";

interface LinkedAccountProvider {
  id: "google";
  label: string;
  enabled: boolean;
  linked: boolean;
  linkedAt: string | null;
}

export function SettingsContent() {
  const { data: session } = useSession();
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailVerifiedAt, setEmailVerifiedAt] = useState<string | null>(null);
  const [emailVerificationMode, setEmailVerificationMode] = useState<
    "off" | "optional" | "required_for_new_accounts"
  >("off");
  const [emailProviderReady, setEmailProviderReady] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [emailChangeLoading, setEmailChangeLoading] = useState(false);
  const [emailChangeMessage, setEmailChangeMessage] = useState("");
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [bio, setBio] = useState("");
  const [settings, setSettings] = useState<DashboardSettingsState>(defaultDashboardSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [linkedProviders, setLinkedProviders] = useState<LinkedAccountProvider[]>([]);
  const [hasPassword, setHasPassword] = useState(true);
  const [accountLinkLoading, setAccountLinkLoading] = useState(false);
  const [accountLinkMessage, setAccountLinkMessage] = useState("");

  const username = session?.user?.name || "";

  useEffect(() => {
    writeDashboardSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    setDisplayName(session.user.name || "");
    setSettings(readDashboardSettings());

    const load = async () => {
      try {
        const [response, verificationResponse, emailChangeResponse, linkedAccountsResponse] = await Promise.all([
          fetch("/api/user/me", { cache: "no-store" }),
          fetch("/api/auth/email-verification/status", { cache: "no-store" }),
          fetch("/api/auth/email-change/status", { cache: "no-store" }),
          fetch("/api/auth/linked-accounts", { cache: "no-store" }),
        ]);
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as UserInventoryResponse;
        const resolvedDisplayName =
          payload.profile.displayName || payload.name || session.user.name || "";
        setDisplayName(resolvedDisplayName);
        localStorage.setItem("tabu_username", resolvedDisplayName);
        setEmail(payload.email || "");
        setEmailVerifiedAt(payload.emailVerifiedAt);
        setBio(payload.profile.bio || "");
        if (verificationResponse.ok) {
          const verification = (await verificationResponse.json()) as {
            mode: "off" | "optional" | "required_for_new_accounts";
            providerReady: boolean;
            emailVerifiedAt: string | null;
          };
          setEmailVerificationMode(verification.mode);
          setEmailProviderReady(verification.providerReady);
          setEmailVerifiedAt(verification.emailVerifiedAt);
        }
        if (emailChangeResponse.ok) {
          const emailChange = (await emailChangeResponse.json()) as {
            pendingEmail: string | null;
          };
          setPendingEmail(emailChange.pendingEmail);
        }
        if (linkedAccountsResponse.ok) {
          const linkedAccounts = (await linkedAccountsResponse.json()) as {
            hasPassword: boolean;
            providers: LinkedAccountProvider[];
          };
          setHasPassword(linkedAccounts.hasPassword);
          setLinkedProviders(linkedAccounts.providers);
        }
      } catch {
        // Keep local fallbacks.
      }
    };

    void load();
  }, [session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error === "OAuthAccountNotLinked") {
      setAccountLinkMessage(
        t("settings.linkConflict")
      );
    } else if (error) {
      setAccountLinkMessage(t("settings.linkFailed"));
    } else if (params.get("linked") === "1") {
      setAccountLinkMessage(t("settings.googleLinked"));
    }
  }, [t]);

  const handleOAuthAccount = async (provider: LinkedAccountProvider) => {
    setAccountLinkLoading(true);
    setAccountLinkMessage("");
    if (!provider.linked) {
      await signIn(provider.id, { callbackUrl: "/dashboard?tab=settings&linked=1" });
      return;
    }
    try {
      const response = await fetch("/api/auth/linked-accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setAccountLinkMessage(payload?.error || t("settings.unlinkFailed"));
        return;
      }
      setLinkedProviders((current) =>
        current.map((item) =>
          item.id === provider.id
            ? { ...item, linked: false, linkedAt: null }
            : item
        )
      );
      setAccountLinkMessage(t("settings.unlinked", { provider: provider.label }));
    } catch {
      setAccountLinkMessage(t("settings.linkServiceFailed"));
    } finally {
      setAccountLinkLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError("");

    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          bio,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setSaveError(payload?.error || t("settings.profileUpdateFailed"));
        return;
      }

      const payload = (await response.json()) as {
        profile?: { displayName?: string | null };
      };
      const nextDisplayName =
        payload.profile?.displayName?.trim() || session?.user?.name || displayName.trim();
      localStorage.setItem("tabu_username", nextDisplayName);
      window.dispatchEvent(
        new CustomEvent("tabu:display-name-updated", {
          detail: { displayName: nextDisplayName },
        })
      );
      setDisplayName(nextDisplayName);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError(t("settings.profileUpdateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleEmailChange = async () => {
    setEmailChangeLoading(true);
    setEmailChangeMessage("");
    try {
      const response = await fetch("/api/auth/email-change/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, currentPassword }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        pendingEmail?: string;
      } | null;
      setEmailChangeMessage(
        response.ok
          ? payload?.message || t("settings.verificationLinkSent")
          : payload?.error || t("settings.emailChangeFailed")
      );
      if (response.ok) {
        setPendingEmail(payload?.pendingEmail || newEmail.trim());
        setNewEmail("");
        setCurrentPassword("");
      }
    } catch {
      setEmailChangeMessage(t("settings.emailChangeServiceFailed"));
    } finally {
      setEmailChangeLoading(false);
    }
  };

  const handleCancelEmailChange = async () => {
    setEmailChangeLoading(true);
    setEmailChangeMessage("");
    try {
      const response = await fetch("/api/auth/email-change/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setEmailChangeMessage(
        response.ok
          ? t("settings.emailChangeCancelled")
          : payload?.error || t("settings.cancelFailed")
      );
      if (response.ok) {
        setPendingEmail(null);
        setCurrentPassword("");
      }
    } catch {
      setEmailChangeMessage(t("settings.cancelServiceFailed"));
    } finally {
      setEmailChangeLoading(false);
    }
  };

  const handleSendVerification = async () => {
    setSendingVerification(true);
    setVerificationMessage("");
    try {
      const response = await fetch("/api/auth/email-verification/request", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        status?: string;
      } | null;
      setVerificationMessage(
        response.ok
          ? payload?.message || t("auth.verificationQueued")
          : payload?.error || t("settings.verificationSendFailed")
      );
      if (payload?.status === "already_verified") {
        setEmailVerifiedAt(new Date().toISOString());
      }
    } catch {
      setVerificationMessage(t("auth.verificationUnavailable"));
    } finally {
      setSendingVerification(false);
    }
  };

  return (
    <DashboardPageShell
      eyebrow={t("settings.preferences")}
      title={t("settings.title")}
      description={t("settings.description")}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <DashboardSection
            title={t("settings.profile")}
            description={t("settings.profileHelp")}
            action={<User size={18} className="text-blue-500" />}
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {t("settings.username")}
                </div>
                <div className="text-sm font-black text-slate-800 dark:text-slate-100">@{username}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("settings.usernameHelp")}
                </div>
              </div>

              <div>
                <label
                  className="mb-1.5 block text-xs font-bold uppercase text-slate-500 dark:text-slate-400"
                  htmlFor="displayName"
                >
                  {t("settings.displayName")}
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  maxLength={60}
                />
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("settings.displayNameHelp")}
                </div>
              </div>

              <div>
                <label
                  className="mb-1.5 block text-xs font-bold uppercase text-slate-500 dark:text-slate-400"
                  htmlFor="email"
                >
                  {t("auth.email")}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  readOnly
                  className="w-full cursor-default rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  maxLength={191}
                  autoComplete="email"
                />
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {email
                    ? emailVerifiedAt
                      ? t("settings.emailVerified")
                      : emailVerificationMode === "off"
                        ? t("settings.verificationOff")
                        : emailProviderReady
                          ? t("settings.verificationHelp")
                          : t("settings.verificationNotReady")
                    : t("settings.noEmail")}
                </div>
                {email &&
                !emailVerifiedAt &&
                emailVerificationMode !== "off" ? (
                  <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-900/60 dark:bg-teal-950/20">
                    <button
                      type="button"
                      onClick={() => void handleSendVerification()}
                      disabled={!emailProviderReady || sendingVerification}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 text-xs font-black text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MailCheck size={15} />
                      {sendingVerification
                        ? t("auth.sending")
                        : t("settings.verifyEmail")}
                    </button>
                    {verificationMessage ? (
                      <p className="mt-2 text-xs leading-5 text-teal-800 dark:text-teal-200">
                        {verificationMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {hasPassword ? <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40">
                  <div>
                    <div className="text-sm font-black text-slate-800 dark:text-slate-100">
                      {t("settings.changeEmail")}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {t("settings.changeEmailHelp")}
                    </p>
                  </div>
                  {pendingEmail ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                      <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        {t("settings.pendingEmail", { email: pendingEmail })}
                      </p>
                      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                        {t("settings.cancelEmailHelp")}
                      </p>
                    </div>
                  ) : (
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(event) => setNewEmail(event.target.value)}
                      placeholder={t("settings.newEmail")}
                      autoComplete="email"
                      maxLength={191}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  )}
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder={t("settings.currentPassword")}
                    autoComplete="current-password"
                    maxLength={256}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void (pendingEmail
                        ? handleCancelEmailChange()
                        : handleEmailChange())
                    }
                    disabled={
                      emailChangeLoading ||
                      currentPassword.length === 0 ||
                      (!pendingEmail && newEmail.trim().length === 0)
                    }
                    className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      pendingEmail
                        ? "bg-rose-600 hover:bg-rose-700"
                        : "bg-slate-800 hover:bg-slate-900 dark:bg-slate-200 dark:text-slate-900"
                    }`}
                  >
                    {emailChangeLoading
                      ? t("settings.processing")
                      : pendingEmail
                        ? t("settings.cancelPending")
                        : t("settings.verifyNewEmail")}
                  </button>
                  {emailChangeMessage ? (
                    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                      {emailChangeMessage}
                    </p>
                  ) : null}
                </div> : null}
              </div>

              <div>
                <label
                  className="mb-1.5 block text-xs font-bold uppercase text-slate-500 dark:text-slate-400"
                  htmlFor="bio"
                >
                  {t("settings.biography")}
                </label>
                <textarea
                  id="bio"
                  rows={3}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  maxLength={300}
                />
              </div>

              {saveError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  {saveError}
                </div>
              ) : null}

              <div className="pt-2 text-right">
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 disabled:opacity-50"
                  type="button"
                >
                  <Save size={14} />
                  {saved ? t("settings.saved") : saving ? t("settings.saving") : t("settings.saveChanges")}
                </button>
              </div>
            </div>
          </DashboardSection>
        </div>

        <div className="space-y-6">
          <DashboardSection
            title={t("settings.game")}
            description={t("settings.gameHelp")}
            action={<Gamepad2 size={18} className="text-orange-500" />}
          >
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Volume2 size={18} className="text-slate-400" />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {t("settings.soundEffects")}
                  </span>
                </div>
                <ToggleSwitch
                  checked={settings.soundOn}
                  onChange={(value) => setSettings((current) => ({ ...current, soundOn: value }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Music size={18} className="text-slate-400" />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {t("settings.backgroundMusic")}
                  </span>
                </div>
                <ToggleSwitch
                  checked={settings.musicOn}
                  onChange={(value) => setSettings((current) => ({ ...current, musicOn: value }))}
                />
              </div>
            </div>
          </DashboardSection>

          {linkedProviders.length > 0 ? <DashboardSection
            title={t("settings.linkedAccounts")}
            description={t("settings.linkedAccountsHelp")}
            action={<Link2 size={18} className="text-teal-600" />}
          >
            <div className="space-y-3">
              {linkedProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-800 shadow-sm dark:bg-slate-800 dark:text-white">
                        G
                      </span>
                      <div>
                        <div className="text-sm font-black text-slate-800 dark:text-slate-100">
                          {provider.label}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {provider.linked ? t("settings.linkedReady") : t("settings.notLinked")}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={
                        accountLinkLoading || (!provider.enabled && !provider.linked)
                      }
                      onClick={() => void handleOAuthAccount(provider)}
                      className={`min-h-10 rounded-xl px-4 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        provider.linked
                          ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-950 dark:text-rose-300"
                          : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                      }`}
                    >
                      {accountLinkLoading
                        ? t("settings.processing")
                        : provider.linked
                          ? t("settings.unlink")
                          : t("settings.link")}
                    </button>
                  </div>
              ))}
              {!hasPassword ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                  {t("settings.onlyLoginHelp")}
                </div>
              ) : null}
              {accountLinkMessage ? (
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {accountLinkMessage}
                </p>
              ) : null}
            </div>
          </DashboardSection> : null}

          <DashboardSection
            title={t("settings.account")}
            description={t("settings.accountHelp")}
            action={<UserCog size={18} className="text-red-500" />}
          >
            <div className="space-y-3">
              <button
                onClick={() => {
                  window.location.href = "/forgot-password";
                }}
                className="group flex w-full items-center justify-between rounded-xl p-3 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                type="button"
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {hasPassword ? t("settings.resetPassword") : t("settings.createPassword")}
                </span>
                <ChevronRight size={18} className="text-slate-400 group-hover:text-blue-500" />
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="group flex w-full items-center justify-between rounded-xl p-3 text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                type="button"
              >
                <span className="text-sm font-bold">{t("settings.logout")}</span>
                <LogOut size={18} />
              </button>
            </div>
          </DashboardSection>
        </div>
      </div>
    </DashboardPageShell>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors ${
        checked ? "bg-blue-500" : "bg-slate-300 dark:bg-slate-600"
      }`}
      type="button"
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
