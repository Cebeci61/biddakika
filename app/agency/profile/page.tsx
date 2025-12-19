"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";

type AgencyProfile = {
  agencyName?: string | null;
  phone?: string | null;
  phone2?: string | null;
  emailPublic?: string | null;

  address?: string | null;
  city?: string | null;
  district?: string | null;

  website?: string | null;
  instagram?: string | null;
  whatsapp?: string | null;

  taxOffice?: string | null;
  taxNo?: string | null;
  iban?: string | null;

  description?: string | null;

  // operasyon
  serviceCities?: string[];        // ["Trabzon","Rize"]
  specialties?: string[];          // ["Incoming","MICE","Karadeniz turları"]
  languages?: string[];            // ["TR","EN","AR"]
  licenseNo?: string | null;       // TÜRSAB vb.
  invoiceType?: "individual" | "company" | null;

  // görseller
  logoUrl?: string | null;
  coverUrl?: string | null;

  // sistem
  status?: "active" | "pending" | "suspended" | null;
  updatedAt?: Timestamp;
};

type UserDoc = {
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  agencyProfile?: AgencyProfile;
};

function safeStr(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function uniqTrim(arr: string[]) {
  return Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean)));
}

function toArrayFromText(text: string) {
  // virgül veya satır satır
  const raw = text
    .split(/\n|,/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return uniqTrim(raw);
}

function arrayToText(arr?: string[] | null) {
  return (arr || []).join(", ");
}

function isValidIbanTR(ibanRaw: string) {
  const iban = ibanRaw.replace(/\s+/g, "").toUpperCase();
  if (!iban) return true; // boşsa zorunlu değil
  return iban.startsWith("TR") && iban.length >= 24; // basit kontrol
}

function calcCompletion(p: AgencyProfile) {
  const fields = [
    p.agencyName,
    p.phone,
    p.address,
    p.city,
    p.description,
    p.iban,
    p.taxNo,
    p.logoUrl
  ];
  const filled = fields.filter((x) => safeStr(x).length > 0).length;
  return Math.round((filled / fields.length) * 100);
}
export default function AgencyBusinessPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [pageMsg, setPageMsg] = useState<string | null>(null);

  // form state
  const [agencyName, setAgencyName] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [emailPublic, setEmailPublic] = useState("");

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");

  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  const [taxOffice, setTaxOffice] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [iban, setIban] = useState("");

  const [description, setDescription] = useState("");

  const [serviceCitiesText, setServiceCitiesText] = useState("");
  const [specialtiesText, setSpecialtiesText] = useState("");
  const [languagesText, setLanguagesText] = useState("");

  const [licenseNo, setLicenseNo] = useState("");
  const [invoiceType, setInvoiceType] = useState<"individual" | "company">("company");

  const [logoUrl, setLogoUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");

  const [status, setStatus] = useState<"active" | "pending" | "suspended">("active");
  const [updatedAt, setUpdatedAt] = useState<Timestamp | null>(null);

  // load user doc
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "agency") {
        setLoading(false);
        return;
      }
      setLoading(true);
      setPageErr(null);

      try {
        const ref = doc(db, "users", profile.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() as UserDoc;
          const ap = data.agencyProfile || {};

          setAgencyName(safeStr(ap.agencyName || data.displayName));
          setPhone(safeStr(ap.phone));
          setPhone2(safeStr(ap.phone2));
          setEmailPublic(safeStr(ap.emailPublic));

          setAddress(safeStr(ap.address));
          setCity(safeStr(ap.city));
          setDistrict(safeStr(ap.district));

          setWebsite(safeStr(ap.website));
          setInstagram(safeStr(ap.instagram));
          setWhatsapp(safeStr(ap.whatsapp));

          setTaxOffice(safeStr(ap.taxOffice));
          setTaxNo(safeStr(ap.taxNo));
          setIban(safeStr(ap.iban));

          setDescription(safeStr(ap.description));

          setServiceCitiesText(arrayToText(ap.serviceCities));
          setSpecialtiesText(arrayToText(ap.specialties));
          setLanguagesText(arrayToText(ap.languages));

          setLicenseNo(safeStr(ap.licenseNo));
          setInvoiceType((ap.invoiceType as any) || "company");

          setLogoUrl(safeStr(ap.logoUrl));
          setCoverUrl(safeStr(ap.coverUrl));

          setStatus((ap.status as any) || "active");
          setUpdatedAt((ap.updatedAt as any) || null);
        } else {
          // yeni kullanıcıysa: displayName’i default doldur
          setAgencyName(safeStr(profile.displayName || profile.email));
          setStatus("active");
        }
      } catch (e: any) {
        console.error(e);
        setPageErr(e?.message || "İşletme bilgileri okunamadı.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  const completion = useMemo(() => {
    const p: AgencyProfile = {
      agencyName,
      phone,
      address,
      city,
      description,
      iban,
      taxNo,
      logoUrl
    };
    return calcCompletion(p);
  }, [agencyName, phone, address, city, description, iban, taxNo, logoUrl]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setPageErr(null);
    setPageMsg(null);

    if (!profile?.uid) {
      setPageErr("Giriş bilgisi yok.");
      return;
    }
    if (!agencyName.trim()) {
      setPageErr("Acenta adı zorunlu.");
      return;
    }
    if (!phone.trim()) {
      setPageErr("Telefon zorunlu.");
      return;
    }
    if (!city.trim()) {
      setPageErr("Şehir zorunlu.");
      return;
    }
    if (!isValidIbanTR(iban)) {
      setPageErr("IBAN formatı hatalı görünüyor. (TR ile başlamalı)");
      return;
    }

    try {
      setSaving(true);

      const payload: AgencyProfile = {
        agencyName: agencyName.trim(),
        phone: phone.trim(),
        phone2: phone2.trim() || null,
        emailPublic: emailPublic.trim() || null,

        address: address.trim() || null,
        city: city.trim(),
        district: district.trim() || null,

        website: website.trim() || null,
        instagram: instagram.trim() || null,
        whatsapp: whatsapp.trim() || null,

        taxOffice: taxOffice.trim() || null,
        taxNo: taxNo.trim() || null,
        iban: iban.trim() || null,

        description: description.trim() || null,

        serviceCities: toArrayFromText(serviceCitiesText),
        specialties: toArrayFromText(specialtiesText),
        languages: toArrayFromText(languagesText),

        licenseNo: licenseNo.trim() || null,
        invoiceType: invoiceType || "company",

        logoUrl: logoUrl.trim() || null,
        coverUrl: coverUrl.trim() || null,

        status,
        updatedAt: serverTimestamp() as any
      };

      // users/{uid} merge
      await setDoc(
        doc(db, "users", profile.uid),
        {
          role: "agency",
          displayName: agencyName.trim(), // listelerde güzel görünsün
          agencyProfile: payload,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      setUpdatedAt(Timestamp.fromDate(new Date()));
      setPageMsg("İşletme bilgileri kaydedildi.");
      setTimeout(() => setPageMsg(null), 1400);
    } catch (e: any) {
      console.error(e);
      setPageErr(e?.message || "Kayıt sırasında hata oluştu. (Rules / bağlantı kontrol et)");
    } finally {
      setSaving(false);
    }
  }
  if (authLoading || loading) {
    return (
      <Protected allowedRoles={["agency"]}>
        <div className="container-page">
          <p className="text-sm text-slate-400">Yükleniyor...</p>
        </div>
      </Protected>
    );
  }

  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-100">İşletmem</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                Acenta profilini burada yönetirsin. Bu bilgiler; paket tekliflerinde, acenta taleplerinde ve müşteriyle iletişim ekranlarında kullanılır.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[0.75rem] text-emerald-200">
                Profil tamamlama: <b className="ml-1">{completion}%</b>
              </span>
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.75rem] ${
                status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : status === "pending" ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}>
                Durum: <b className="ml-1">{status}</b>
              </span>
            </div>
          </div>

          {updatedAt && (
            <p className="text-[0.75rem] text-slate-500">
              Son güncelleme: {updatedAt.toDate().toLocaleString("tr-TR")}
            </p>
          )}
        </section>

        {(pageErr || pageMsg) && (
          <div className="space-y-2">
            {pageErr && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
                {pageErr}
              </div>
            )}
            {pageMsg && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200 text-sm">
                {pageMsg}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSave} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* sol: form */}
          <div className="space-y-4">
            <Card title="Temel bilgiler">
              <Grid cols={2}>
                <Field label="Acenta adı">
                  <input className="input" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Örn: Yunus Travel" />
                </Field>
                <Field label="E-posta (profil)">
                  <input className="input opacity-80" value={safeStr(profile?.email)} disabled />
                </Field>
                <Field label="Telefon">
                  <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+90..." />
                </Field>
                <Field label="2. Telefon (ops.)">
                  <input className="input" value={phone2} onChange={(e) => setPhone2(e.target.value)} placeholder="+90..." />
                </Field>
                <Field label="E-posta (müşteriye görünsün) (ops.)" span={2}>
                  <input className="input" value={emailPublic} onChange={(e) => setEmailPublic(e.target.value)} placeholder="info@..." />
                </Field>
              </Grid>
            </Card>

            <Card title="Adres & lokasyon">
              <Grid cols={2}>
                <Field label="Şehir">
                  <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Trabzon" />
                </Field>
                <Field label="İlçe (ops.)">
                  <input className="input" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Ortahisar" />
                </Field>
                <Field label="Adres" span={2}>
                  <textarea className="input h-24 text-xs" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Mahalle, cadde, no..." />
                </Field>
              </Grid>
            </Card>

            <Card title="Online kanallar">
              <Grid cols={2}>
                <Field label="Web sitesi (ops.)">
                  <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
                </Field>
                <Field label="Instagram (ops.)">
                  <input className="input" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@kullanici" />
                </Field>
                <Field label="WhatsApp (ops.)" span={2}>
                  <input className="input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+90..." />
                </Field>
              </Grid>
            </Card>

            <Card title="Faturalandırma">
              <Grid cols={2}>
                <Field label="Fatura tipi">
                  <select className="input" value={invoiceType} onChange={(e) => setInvoiceType(e.target.value as any)}>
                    <option value="company">Şirket</option>
                    <option value="individual">Bireysel</option>
                  </select>
                </Field>
                <Field label="Lisans / TÜRSAB No (ops.)">
                  <input className="input" value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} placeholder="Opsiyonel" />
                </Field>
                <Field label="Vergi dairesi (ops.)">
                  <input className="input" value={taxOffice} onChange={(e) => setTaxOffice(e.target.value)} placeholder="Ortahisar V.D." />
                </Field>
                <Field label="Vergi / TC No (ops.)">
                  <input className="input" value={taxNo} onChange={(e) => setTaxNo(e.target.value)} placeholder="..." />
                </Field>
                <Field label="IBAN (ops.)" span={2}>
                  <input className="input" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR.." />
                  <p className="text-[0.7rem] text-slate-500 mt-1">Boşluk olabilir, sistem kaydeder. (TR ile başlaması önerilir)</p>
                </Field>
              </Grid>
            </Card>

            <Card title="Operasyon & uzmanlık">
              <Grid cols={2}>
                <Field label="Hizmet verdiğin şehirler (virgülle)">
                  <input className="input" value={serviceCitiesText} onChange={(e) => setServiceCitiesText(e.target.value)} placeholder="Trabzon, Rize, Artvin" />
                </Field>
                <Field label="Uzmanlıklar (virgülle)">
                  <input className="input" value={specialtiesText} onChange={(e) => setSpecialtiesText(e.target.value)} placeholder="Incoming, MICE, Karadeniz turları" />
                </Field>
                <Field label="Diller (virgülle)">
                  <input className="input" value={languagesText} onChange={(e) => setLanguagesText(e.target.value)} placeholder="TR, EN, AR" />
                </Field>
                <Field label="Sistem durumu">
                  <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)}>
                    <option value="active">active</option>
                    <option value="pending">pending</option>
                    <option value="suspended">suspended</option>
                  </select>
                </Field>
                <Field label="Açıklama (profil yazısı)" span={2}>
                  <textarea className="input h-28 text-xs" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Örn: Kurumsal paketler, VIP transfer, Karadeniz incoming..." />
                </Field>
              </Grid>
            </Card>

            <Card title="Görseller">
              <Grid cols={2}>
                <Field label="Logo URL (ops.)">
                  <input className="input" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
                </Field>
                <Field label="Kapak URL (ops.)">
                  <input className="input" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://..." />
                </Field>
              </Grid>

              <div className="grid gap-3 md:grid-cols-2 mt-3">
                <Preview title="Logo önizleme" url={logoUrl} />
                <Preview title="Kapak önizleme" url={coverUrl} />
              </div>

              <div className="flex justify-end mt-4">
                <button
                  disabled={saving}
                  className="rounded-md bg-emerald-500 text-slate-950 px-5 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60"
                >
                  {saving ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
            </Card>
          </div>

          {/* sağ: hızlı özet */}
          <aside className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 h-fit sticky top-20 space-y-3">
            <p className="text-sm font-semibold text-slate-100">Hızlı özet</p>

            <Mini label="Acenta" value={agencyName || "—"} />
            <Mini label="Telefon" value={phone || "—"} />
            <Mini label="Şehir" value={city || "—"} />
            <Mini label="Profil tamamlama" value={`${completion}%`} highlight />

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-[0.72rem] text-slate-400">Not</p>
              <p className="text-[0.8rem] text-slate-200 mt-1">
                Bu alanlar; paket tekliflerinde ve acenta taleplerinde “acenta bilgisi” olarak gösterilecek.
              </p>
            </div>
          </aside>
        </form>

        <style jsx global>{`
          .input {
            width: 100%;
            border-radius: 0.75rem;
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(51, 65, 85, 1);
            padding: 0.65rem 0.85rem;
            color: #e5e7eb;
            outline: none;
            font-size: 0.9rem;
          }
          .input:focus { border-color: rgba(52, 211, 153, 0.8); }
        `}</style>
      </div>
    </Protected>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 space-y-3">
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      {children}
    </div>
  );
}

function Grid({ cols, children }: { cols: 2 | 3 | 4; children: React.ReactNode }) {
  const cls =
    cols === 4 ? "grid gap-3 md:grid-cols-4" :
    cols === 3 ? "grid gap-3 md:grid-cols-3" :
    "grid gap-3 md:grid-cols-2";
  return <div className={cls}>{children}</div>;
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: 2 | 3 | 4 }) {
  const spanCls =
    span === 2 ? "md:col-span-2" :
    span === 3 ? "md:col-span-3" :
    span === 4 ? "md:col-span-4" : "";
  return (
    <div className={`space-y-1 ${spanCls}`}>
      <label className="text-xs text-slate-200">{label}</label>
      {children}
    </div>
  );
}

function Mini({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-950/60 p-3 ${highlight ? "ring-1 ring-emerald-500/25" : ""}`}>
      <p className="text-[0.72rem] text-slate-400">{label}</p>
      <p className={`text-sm mt-1 ${highlight ? "text-emerald-300 font-extrabold" : "text-slate-100 font-semibold"}`}>{value}</p>
    </div>
  );
}

function Preview({ title, url }: { title: string; url: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400 mb-2">{title}</p>
      {url ? (
        <img src={url} alt={title} className="w-full h-32 object-cover rounded-lg border border-slate-800" />
      ) : (
        <div className="w-full h-32 rounded-lg border border-slate-800 bg-slate-900/50 flex items-center justify-center text-slate-500 text-xs">
          Görsel yok
        </div>
      )}
    </div>
  );
}
