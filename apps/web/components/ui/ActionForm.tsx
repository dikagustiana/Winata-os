"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-types";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionButton {
  label: string;
  name?: string;
  value?: string;
  variant?: "primary" | "default" | "danger";
  confirm?: string;
}

function SubmitButton({ label, variant = "primary" }: { label: string; variant?: ActionButton["variant"] }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn ${variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : ""}`}
      disabled={pending}
    >
      {pending ? "Menyimpan…" : label}
    </button>
  );
}

function ButtonSet({ buttons }: { buttons: ActionButton[] }) {
  return (
    <>
      {buttons.map((button) => (
        <button
          key={button.label}
          type="submit"
          name={button.name}
          value={button.value ?? button.label}
          className={`btn ${button.variant === "primary" ? "btn-primary" : button.variant === "danger" ? "btn-danger" : ""}`}
        >
          {button.label}
        </button>
      ))}
    </>
  );
}

export function ActionForm({
  action,
  children,
  submitLabel = "Simpan",
  buttons,
  className = "stack",
  successMessage = "Tersimpan.",
  resetOnSuccess = false,
  formId,
}: {
  action: ServerAction;
  children: ReactNode;
  submitLabel?: string;
  buttons?: ActionButton[];
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  formId?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ActionButton | null>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const info = state.error ? (
    <div className="banner banner-fail" role="alert">
      {state.error}
    </div>
  ) : state.ok ? (
    <div className="banner banner-ok" role="status">
      {state.message ?? successMessage}
    </div>
  ) : null;

  return (
    <form ref={formRef} action={formAction} className={className} id={formId}>
      {children}
      {pendingConfirm ? (
        <div className="banner banner-warn stack">
          <span>{pendingConfirm.confirm}</span>
          <div className="row">
            <button
              type="submit"
              name={pendingConfirm.name}
              value={pendingConfirm.value ?? pendingConfirm.label}
              className={`btn ${pendingConfirm.variant === "danger" ? "btn-danger" : "btn-primary"}`}
            >
              Ya, lanjutkan
            </button>
            <button type="button" className="btn" onClick={() => setPendingConfirm(null)}>
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          {buttons ? (
            buttons.map((button) =>
              button.confirm ? (
                <button
                  key={button.label}
                  type="button"
                  className={`btn ${button.variant === "danger" ? "btn-danger" : button.variant === "primary" ? "btn-primary" : ""}`}
                  onClick={() => setPendingConfirm(button)}
                >
                  {button.label}
                </button>
              ) : null,
            )
          ) : (
            <SubmitButton label={submitLabel} />
          )}
          {buttons && buttons.some((b) => !b.confirm) ? (
            <ButtonSet buttons={buttons.filter((b) => !b.confirm)} />
          ) : null}
        </div>
      )}
      <div aria-live="polite">{info}</div>
    </form>
  );
}

export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-sm btn-ghost" disabled={pending}>
      Keluar
    </button>
  );
}
