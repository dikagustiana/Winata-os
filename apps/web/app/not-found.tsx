import Link from "next/link";

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: "center" }}>
        <p className="page-title">Halaman tidak tersedia</p>
        <p className="page-sub" style={{ marginTop: 8 }}>
          Alamat ini tidak ada, atau peran Anda tidak berhak membukanya.
        </p>
        <p style={{ marginTop: 16 }}>
          <Link href="/" className="btn btn-primary">
            Kembali ke dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
