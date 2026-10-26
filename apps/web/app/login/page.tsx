import { redirect } from "next/navigation";
import { getViewer } from "@/lib/session";
import { isMockAuth } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect("/");
  const mock = isMockAuth();

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span className="brand" style={{ fontSize: 16 }}>
            Winata Egg Position
          </span>
        </div>
        <h1 className="login-title">Masuk</h1>
        <p className="login-hint">
          PT Winata Mega Agro · Gunung Jati Group. Gunakan e-mail yang terdaftar; pendaftaran mandiri tidak
          tersedia.
        </p>
        <LoginForm mock={mock} />
        {mock ? (
          <p className="login-hint" style={{ marginTop: 16 }}>
            Mode lokal: akun uji memakai kata sandi <strong>winata123</strong>. Contoh: kandang.slp@winata.test,
            manager@winata.test, accounting@winata.test, marketing@winata.test, bod@winata.test,
            dika.g.irawan@gmail.com.
          </p>
        ) : null}
      </div>
    </div>
  );
}
