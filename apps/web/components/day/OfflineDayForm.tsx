"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-types";
import { clearDraft, loadDraft, saveDraft, type StoredDraft } from "@/lib/offline/draftStore";
import { translateDbError } from "@/lib/errors";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/**
 * K8: form /hari menyimpan draft di IndexedDB saat sinyal putus, mengirim saat
 * tersambung. Konflik (hari sudah disetujui/dikunci) ditampilkan dan draft TIDAK
 * ditimpa.
 */
export function OfflineDayForm({
  action,
  storageKey,
  children,
  disabled = false,
  saveLabel = "Simpan draft",
  submitLabel = "Selesai hari ini",
  status,
}: {
  action: ServerAction;
  storageKey: string;
  children: ReactNode;
  disabled?: boolean;
  saveLabel?: string;
  submitLabel?: string;
  status?: ReactNode;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const [online, setOnline] = useState(true);
  const [draft, setDraft] = useState<StoredDraft | null>(null);
  const [pending, setPending] = useState<{ intent: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDraft(storageKey).then((stored) => {
      if (cancelled || !stored || !formRef.current) return;
      setDraft(stored);
      for (const [name, value] of Object.entries(stored.values)) {
        const element = formRef.current.elements.namedItem(name);
        if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
          element.value = value;
        }
      }
      setNotice(`Draft tersimpan di HP (${new Date(stored.savedAt).toLocaleTimeString("id-ID")}).`);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!state.ok) return;
    clearDraft(storageKey).then(() => {
      setDraft(null);
      setPending(null);
      setNotice(null);
    });
  }, [state.ok, storageKey]);

  // Kirim draft yang tertunda ketika kembali online.
  useEffect(() => {
    if (!online || !pending || !formRef.current || disabled) return;
    const button = pending.intent === "submit" ? submitButtonRef.current : saveButtonRef.current;
    formRef.current.requestSubmit(button ?? undefined);
  }, [online, pending, disabled]);

  function persist(intent?: string) {
    if (!formRef.current) return;
    const stored: StoredDraft = {
      key: storageKey,
      values: formValues(formRef.current),
      savedAt: new Date().toISOString(),
      intent,
    };
    saveDraft(stored);
    setDraft(stored);
  }

  function onlineLabel() {
    if (!online) return "Tidak ada sinyal · draft disimpan di HP";
    if (draft) return "Draft tersimpan di HP · akan dikirim saat disimpan";
    return "Tersambung";
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="stack"
      onChange={() => persist()}
      onSubmit={(event) => {
        if (!online) {
          event.preventDefault();
          const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const intent = submitter?.value ?? "save";
          persist(intent);
          setPending({ intent });
          setNotice("Tidak ada sinyal. Draft tersimpan di HP dan akan dikirim saat tersambung.");
        }
      }}
    >
      <div className="banner banner-info small" role="status" aria-live="polite">
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>{onlineLabel()}</span>
          {status}
        </span>
      </div>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {children}
      </fieldset>
      <div className="action-bar">
        <button
          ref={saveButtonRef}
          type="submit"
          name="intent"
          value="save"
          className="btn"
          disabled={disabled}
        >
          {saveLabel}
        </button>
        <button
          ref={submitButtonRef}
          type="submit"
          name="intent"
          value="submit"
          className="btn btn-primary"
          disabled={disabled}
        >
          {submitLabel}
        </button>
      </div>
      <div aria-live="polite">
        {state.error ? (
          <div className="banner banner-fail" role="alert">
            {translateDbError(state.error)}
            {state.conflict ? <div className="small">Draft di HP tidak ditimpa. Muat ulang setelah hari dibuka kembali.</div> : null}
          </div>
        ) : null}
        {state.ok ? (<div className="banner banner-ok" role="status">{state.message ?? "Tersimpan."}</div>) : null}
        {notice && !state.ok && !state.error ? <div className="banner banner-warn">{notice}</div> : null}
      </div>
    </form>
  );
}
