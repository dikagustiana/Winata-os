"use client";

import { ActionForm } from "@/components/ui/ActionForm";
import { loginAction } from "@/lib/auth-actions";

export function LoginForm({ mock }: { mock: boolean }) {
  return (
    <ActionForm action={loginAction} submitLabel="Masuk" className="stack" successMessage="Berhasil masuk.">
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="username"
          required
          defaultValue={mock ? "kandang.slp@winata.test" : ""}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Kata sandi</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          defaultValue={mock ? "winata123" : ""}
        />
      </div>
    </ActionForm>
  );
}
