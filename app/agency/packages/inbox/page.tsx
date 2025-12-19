// app/agency/packages/inbox/page.tsx
"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";

type IncludeKey = "hotel" | "transfer" | "tour" | "guide" | "insurance";

type PackageRequest = {
  id: string;

  createdByRole: "guest" | "agency";
  createdById: string;
  createdByName?: string | null;
  createdByPhone?: string | null;

  title?: string | null;

  city: string;
  district?: string | null;

  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  nights?: number;

  paxAdults: number;
  paxChildren?: number;
  childrenAges?: number[];

  boardTypes?: string[];
  hotelCategoryPref?: string[];

  include?: Partial<Record<IncludeKey, boolean>>;

  budgetMin?: number | null;
  budgetMax?: number | null;

  responseDeadlineMinutes?: number | null;
  notes?: string | null;

  status?: "open" | "expired" | "accepted" | "cancelled";

  createdAt?: Timestamp;
};

type PackageOffer = {
  id: string;
  requestId: string;

  agencyId: string;
  agencyName?: string | null;

  totalPrice: number;
  currency: string;

  breakdown?: {
    hotel?: number;
    transfer?: number;
    tours?: number;
    other?: number;
  };

  packageDetails?: {
    hotelName?: string;
    roomType?: string;
    boardType?: string;
    transferType?: string;
    tourPlan?: string[];
    guideIncluded?: boolean;
  };

  note?: string | null;

  status?: "sent" | "updated" | "withdrawn" | "accepted" | "rejected";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalized(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function diffInDays(a: Date, b: Date) {
  const ms = normalized(a).getTime() - normalized(b).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function calcNights(from?: string, to?: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 1;
  const d = diffInDays(b, a);
  return d > 0 ? d : 1;
}

function includesLabel(include?: Partial<Record<IncludeKey, boolean>>) {
  const inc = include || {};
  const on: string[] = [];
  if (inc.hotel) on.push("Otel");
  if (inc.transfer) on.push("Transfer");
  if (inc.tour) on.push("Tur");
  if (inc.guide) on.push("Rehber");
  if (inc.insurance) on.push("Sigorta");
  return on.length ? on.join(" • ") : "—";
}
export default function AgencyPackagesInboxPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState<string | null>(null);

  const [requests, setRequests] = useState<PackageRequest[]>([]);
  const [myOffersByReq, setMyOffersByReq] = useState<Record<string, PackageOffer>>({});

  // filters
  const [qText, setQText] = useState("");
  const [cityF, setCityF] = useState("all");
  const [dateFromF, setDateFromF] = useState("");
  const [dateToF, setDateToF] = useState("");
  const [minBudgetF, setMinBudgetF] = useState("");
  const [maxBudgetF, setMaxBudgetF] = useState("");
  const [includeF, setIncludeF] = useState<"all" | IncludeKey>("all");
  const [sortKey, setSortKey] = useState<"new" | "date" | "budget">("new");

  // drawer + offer modal state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerReq, setDrawerReq] = useState<PackageRequest | null>(null);

  // offer form
  const [offerSaving, setOfferSaving] = useState(false);
  const [offerMsg, setOfferMsg] = useState<string | null>(null);
  const [offerErr, setOfferErr] = useState<string | null>(null);

  const [offerTotal, setOfferTotal] = useState("");
  const [currency, setCurrency] = useState("TRY");

  const [bHotel, setBHotel] = useState("");
  const [bTransfer, setBTransfer] = useState("");
  const [bTours, setBTours] = useState("");
  const [bOther, setBOther] = useState("");

  const [dHotelName, setDHotelName] = useState("");
  const [dRoomType, setDRoomType] = useState("");
  const [dBoardType, setDBoardType] = useState("");
  const [dTransferType, setDTransferType] = useState("");
  const [dTourPlan, setDTourPlan] = useState(""); // textarea -> satır satır
  const [dGuideIncluded, setDGuideIncluded] = useState(false);

  const [note, setNote] = useState("");

  // load data
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
        // 1) Paket talepleri (open olanlar)
        const qReq = query(collection(db, "packageRequests"), where("status", "==", "open"));
        const snapReq = await getDocs(qReq);

        const reqs: PackageRequest[] = snapReq.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            createdByRole: v.createdByRole ?? "guest",
            createdById: v.createdById ?? v.createdBy ?? v.guestId ?? "",
            createdByName: v.createdByName ?? null,
            createdByPhone: v.createdByPhone ?? null,
            title: v.title ?? null,

            city: v.city ?? "",
            district: v.district ?? null,

            dateFrom: v.dateFrom ?? v.checkIn ?? "",
            dateTo: v.dateTo ?? v.checkOut ?? "",
            nights: v.nights ?? null,

            paxAdults: Number(v.paxAdults ?? v.adults ?? 0),
            paxChildren: Number(v.paxChildren ?? v.childrenCount ?? 0),
            childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],

            boardTypes: Array.isArray(v.boardTypes) ? v.boardTypes : [],
            hotelCategoryPref: Array.isArray(v.hotelCategoryPref) ? v.hotelCategoryPref : [],

            include: v.include ?? {},

            budgetMin: v.budgetMin ?? null,
            budgetMax: v.budgetMax ?? null,

            responseDeadlineMinutes: v.responseDeadlineMinutes ?? 120,
            notes: v.notes ?? v.generalNote ?? null,

            status: v.status ?? "open",
            createdAt: v.createdAt
          };
        });

        // 2) Bu acentanın verdiği paket teklifleri (requestId eşleştirme)
        const qOff = query(collection(db, "packageOffers"), where("agencyId", "==", profile.uid));
        const snapOff = await getDocs(qOff);

        const map: Record<string, PackageOffer> = {};
        snapOff.docs.forEach((d) => {
          const v = d.data() as any;
          const po: PackageOffer = {
            id: d.id,
            requestId: v.requestId,
            agencyId: v.agencyId,
            agencyName: v.agencyName ?? null,
            totalPrice: Number(v.totalPrice ?? 0),
            currency: v.currency ?? "TRY",
            breakdown: v.breakdown ?? {},
            packageDetails: v.packageDetails ?? {},
            note: v.note ?? null,
            status: v.status ?? "sent",
            createdAt: v.createdAt,
            updatedAt: v.updatedAt
          };
          if (po.requestId) map[po.requestId] = po; // son kaydı baz al
        });

        reqs.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        setRequests(reqs);
        setMyOffersByReq(map);
      } catch (e: any) {
        console.error(e);
        setPageErr(e?.message || "Paket talepleri yüklenirken hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  // city options
  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    requests.forEach((r) => r.city && s.add(r.city));
    return ["all", ...Array.from(s)];
  }, [requests]);

  // filtered
  const filtered = useMemo(() => {
    let list = [...requests];

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const hay = [
          r.id,
          r.title,
          r.city,
          r.district,
          r.createdByRole,
          r.createdByName,
          r.notes
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (cityF !== "all") list = list.filter((r) => r.city === cityF);

    // date filter
    const f = parseDate(dateFromF);
    if (f) {
      list = list.filter((r) => {
        const d = parseDate(r.dateFrom);
        if (!d) return false;
        return normalized(d).getTime() >= normalized(f).getTime();
      });
    }
    const t = parseDate(dateToF);
    if (t) {
      list = list.filter((r) => {
        const d = parseDate(r.dateTo);
        if (!d) return false;
        return normalized(d).getTime() <= normalized(t).getTime();
      });
    }

    const minB = minBudgetF.trim() ? Number(minBudgetF) : null;
    const maxB = maxBudgetF.trim() ? Number(maxBudgetF) : null;
    if (minB != null && !Number.isNaN(minB)) list = list.filter((r) => (r.budgetMin ?? 0) >= minB || (r.budgetMax ?? 0) >= minB);
    if (maxB != null && !Number.isNaN(maxB)) list = list.filter((r) => (r.budgetMax ?? Number.POSITIVE_INFINITY) <= maxB || (r.budgetMin ?? 0) <= maxB);

    if (includeF !== "all") {
      list = list.filter((r) => !!r.include?.[includeF]);
    }

    // sort
    list.sort((a, b) => {
      if (sortKey === "new") return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      if (sortKey === "date") return (parseDate(a.dateFrom)?.getTime() ?? Infinity) - (parseDate(b.dateFrom)?.getTime() ?? Infinity);
      if (sortKey === "budget") return Number((a.budgetMax ?? a.budgetMin ?? 0)) - Number((b.budgetMax ?? b.budgetMin ?? 0));
      return 0;
    });

    return list;
  }, [requests, qText, cityF, dateFromF, dateToF, minBudgetF, maxBudgetF, includeF, sortKey]);

  function openDrawer(r: PackageRequest) {
    setDrawerReq(r);
    setDrawerOpen(true);

    // teklif varsa doldur
    const my = myOffersByReq[r.id];
    setOfferMsg(null);
    setOfferErr(null);

    if (my) {
      setOfferTotal(String(my.totalPrice ?? ""));
      setCurrency(my.currency ?? "TRY");
      setBHotel(String(my.breakdown?.hotel ?? ""));
      setBTransfer(String(my.breakdown?.transfer ?? ""));
      setBTours(String(my.breakdown?.tours ?? ""));
      setBOther(String(my.breakdown?.other ?? ""));
      setDHotelName(my.packageDetails?.hotelName ?? "");
      setDRoomType(my.packageDetails?.roomType ?? "");
      setDBoardType(my.packageDetails?.boardType ?? "");
      setDTransferType(my.packageDetails?.transferType ?? "");
      setDTourPlan((my.packageDetails?.tourPlan ?? []).join("\n"));
      setDGuideIncluded(!!my.packageDetails?.guideIncluded);
      setNote(my.note ?? "");
    } else {
      // temizle
      setOfferTotal("");
      setCurrency("TRY");
      setBHotel("");
      setBTransfer("");
      setBTours("");
      setBOther("");
      setDHotelName("");
      setDRoomType("");
      setDBoardType("");
      setDTransferType("");
      setDTourPlan("");
      setDGuideIncluded(false);
      setNote("");
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerReq(null);
  }

  async function saveOffer() {
    if (!profile?.uid || profile.role !== "agency") return;
    if (!drawerReq) return;

    setOfferMsg(null);
    setOfferErr(null);

    const total = Number(offerTotal);
    if (Number.isNaN(total) || total <= 0) {
      setOfferErr("Toplam fiyat zorunlu ve 0'dan büyük olmalı.");
      return;
    }

    try {
      setOfferSaving(true);

      const existing = myOffersByReq[drawerReq.id];

      const payload = {
        requestId: drawerReq.id,
        agencyId: profile.uid,
        agencyName: profile.displayName ?? profile.email ?? "Acenta",

        totalPrice: total,
        currency,

        breakdown: {
          hotel: bHotel ? Number(bHotel) : 0,
          transfer: bTransfer ? Number(bTransfer) : 0,
          tours: bTours ? Number(bTours) : 0,
          other: bOther ? Number(bOther) : 0
        },

        packageDetails: {
          hotelName: dHotelName || null,
          roomType: dRoomType || null,
          boardType: dBoardType || null,
          transferType: dTransferType || null,
          tourPlan: dTourPlan
            ? dTourPlan
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean)
            : [],
          guideIncluded: dGuideIncluded
        },

        note: note || null
      };

      if (existing?.id) {
        await updateDoc(doc(db, "packageOffers", existing.id), {
          ...payload,
          status: "updated",
          updatedAt: serverTimestamp()
        });

        setMyOffersByReq((prev) => ({
          ...prev,
          [drawerReq.id]: {
            ...prev[drawerReq.id],
            ...payload,
            status: "updated",
            updatedAt: Timestamp.fromDate(new Date())
          } as any
        }));

        setOfferMsg("Teklif güncellendi.");
      } else {
        const ref = await addDoc(collection(db, "packageOffers"), {
          ...payload,
          status: "sent",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        setMyOffersByReq((prev) => ({
          ...prev,
          [drawerReq.id]: {
            id: ref.id,
            ...payload,
            status: "sent",
            createdAt: Timestamp.fromDate(new Date()),
            updatedAt: Timestamp.fromDate(new Date())
          } as any
        }));

        setOfferMsg("Teklif gönderildi.");
      }
    } catch (e: any) {
      console.error(e);
      setOfferErr(e?.message || "Teklif kaydedilirken hata oluştu.");
    } finally {
      setOfferSaving(false);
    }
  }

  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Gelen Paket Talepleri</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Misafir ve acentaların oluşturduğu paket taleplerini burada görürsün. Talebe girip teklifini ver/güncelle.
          </p>
        </section>

        {pageErr && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
            {pageErr}
          </div>
        )}

        {/* Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Arama</label>
              <input value={qText} onChange={(e) => setQText(e.target.value)} className="input" placeholder="şehir, başlık, not..." />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Şehir</label>
              <select value={cityF} onChange={(e) => setCityF(e.target.value)} className="input">
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c === "all" ? "Hepsi" : c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Başlangıç (min)</label>
              <input type="date" value={dateFromF} onChange={(e) => setDateFromF(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Bitiş (max)</label>
              <input type="date" value={dateToF} onChange={(e) => setDateToF(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Min ₺</label>
              <input value={minBudgetF} onChange={(e) => setMinBudgetF(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Max ₺</label>
              <input value={maxBudgetF} onChange={(e) => setMaxBudgetF(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">İçerik filtresi</label>
              <select value={includeF} onChange={(e) => setIncludeF(e.target.value as any)} className="input">
                <option value="all">Hepsi</option>
                <option value="hotel">Otel</option>
                <option value="transfer">Transfer</option>
                <option value="tour">Tur</option>
                <option value="guide">Rehber</option>
                <option value="insurance">Sigorta</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Sırala</label>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="input">
                <option value="new">Yeni → Eski</option>
                <option value="date">Tarihe göre</option>
                <option value="budget">Bütçeye göre</option>
              </select>
            </div>

            <div className="md:col-span-12 flex items-center justify-between">
              <span className="text-[0.75rem] text-slate-400">
                Sonuç: <span className="text-slate-100 font-semibold">{filtered.length}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setQText("");
                  setCityF("all");
                  setDateFromF("");
                  setDateToF("");
                  setMinBudgetF("");
                  setMaxBudgetF("");
                  setIncludeF("all");
                  setSortKey("new");
                }}
                className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
              >
                Temizle
              </button>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-slate-400">Şu an filtrelere uygun paket talebi yok.</p>
        )}

        {!loading && filtered.length > 0 && (
          <section className="space-y-3">
            {filtered.map((r) => {
              const nights = r.nights ?? calcNights(r.dateFrom, r.dateTo);
              const totalPax = r.paxAdults + (r.paxChildren ?? 0);
              const mine = myOffersByReq[r.id];

              return (
                <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-slate-100 font-semibold">
                        {safeStr(r.title, `${r.city}${r.district ? " / " + r.district : ""} Paket Talebi`)}
                      </div>

                      <div className="text-[0.8rem] text-slate-300">
                        {r.city}{r.district ? ` / ${r.district}` : ""} • {r.dateFrom} – {r.dateTo} • {nights} gece
                      </div>

                      <div className="text-[0.75rem] text-slate-400">
                        {totalPax} kişi (Y: {r.paxAdults} • Ç: {r.paxChildren ?? 0}) • {includesLabel(r.include)}
                      </div>

                      {(r.budgetMin != null || r.budgetMax != null) && (
                        <div className="text-[0.75rem] text-slate-400">
                          Bütçe:{" "}
                          <span className="text-slate-200">
                            {r.budgetMin != null ? `${r.budgetMin.toLocaleString("tr-TR")} ₺` : "—"}{" "}
                            –{" "}
                            {r.budgetMax != null ? `${r.budgetMax.toLocaleString("tr-TR")} ₺` : "—"}
                          </span>
                        </div>
                      )}

                      <div className="text-[0.7rem] text-slate-500">
                        Talep sahibi: {r.createdByRole === "agency" ? "Acenta" : "Misafir"} • {safeStr(r.createdByName, "—")}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {mine ? (
                        <div className="text-right">
                          <div className="text-[0.7rem] text-slate-400">Senin teklifin</div>
                          <div className="text-emerald-300 font-extrabold">
                            {mine.totalPrice.toLocaleString("tr-TR")} {mine.currency}
                          </div>
                          <div className="text-[0.7rem] text-slate-500">
                            {mine.status === "updated" ? "Güncellendi" : "Gönderildi"}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[0.75rem] text-slate-400">Henüz teklif vermedin</div>
                      )}

                      <button
                        type="button"
                        onClick={() => openDrawer(r)}
                        className="rounded-md bg-sky-500 text-white px-4 py-2 text-[0.8rem] font-semibold hover:bg-sky-400"
                      >
                        Detay / Teklif ver
                      </button>
                    </div>
                  </div>

                  {r.notes && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[0.75rem] text-slate-300">
                      <span className="text-slate-400">Not:</span> {r.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Drawer */}
        {drawerOpen && drawerReq && (
          <PackageRequestDrawer
            req={drawerReq}
            myOffer={myOffersByReq[drawerReq.id]}
            offerSaving={offerSaving}
            offerMsg={offerMsg}
            offerErr={offerErr}
            offerTotal={offerTotal}
            setOfferTotal={setOfferTotal}
            currency={currency}
            setCurrency={setCurrency}
            bHotel={bHotel}
            setBHotel={setBHotel}
            bTransfer={bTransfer}
            setBTransfer={setBTransfer}
            bTours={bTours}
            setBTours={setBTours}
            bOther={bOther}
            setBOther={setBOther}
            dHotelName={dHotelName}
            setDHotelName={setDHotelName}
            dRoomType={dRoomType}
            setDRoomType={setDRoomType}
            dBoardType={dBoardType}
            setDBoardType={setDBoardType}
            dTransferType={dTransferType}
            setDTransferType={setDTransferType}
            dTourPlan={dTourPlan}
            setDTourPlan={setDTourPlan}
            dGuideIncluded={dGuideIncluded}
            setDGuideIncluded={setDGuideIncluded}
            note={note}
            setNote={setNote}
            onSave={saveOffer}
            onClose={closeDrawer}
          />
        )}

        <style jsx global>{`
          .input {
            width: 100%;
            border-radius: 0.5rem;
            background: rgba(15, 23, 42, 0.7);
            border: 1px solid rgba(51, 65, 85, 1);
            padding: 0.55rem 0.75rem;
            color: #e5e7eb;
            outline: none;
            font-size: 0.85rem;
          }
          .input:focus {
            border-color: rgba(52, 211, 153, 0.8);
          }
        `}</style>
      </div>
    </Protected>
  );
}
function PackageRequestDrawer(props: {
  req: PackageRequest;
  myOffer?: PackageOffer;

  offerSaving: boolean;
  offerMsg: string | null;
  offerErr: string | null;

  offerTotal: string;
  setOfferTotal: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;

  bHotel: string;
  setBHotel: (v: string) => void;
  bTransfer: string;
  setBTransfer: (v: string) => void;
  bTours: string;
  setBTours: (v: string) => void;
  bOther: string;
  setBOther: (v: string) => void;

  dHotelName: string;
  setDHotelName: (v: string) => void;
  dRoomType: string;
  setDRoomType: (v: string) => void;
  dBoardType: string;
  setDBoardType: (v: string) => void;
  dTransferType: string;
  setDTransferType: (v: string) => void;
  dTourPlan: string;
  setDTourPlan: (v: string) => void;
  dGuideIncluded: boolean;
  setDGuideIncluded: (v: boolean) => void;

  note: string;
  setNote: (v: string) => void;

  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  const r = props.req;
  const nights = r.nights ?? calcNights(r.dateFrom, r.dateTo);
  const totalPax = r.paxAdults + (r.paxChildren ?? 0);

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-slate-800 bg-slate-950/95 shadow-2xl overflow-y-auto">
        <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.7rem] text-slate-400">Paket Talebi</p>
            <h2 className="text-base font-semibold text-slate-100">
              {safeStr(r.title, `${r.city} Paket Talebi`)}
            </h2>
            <p className="text-[0.75rem] text-slate-400">
              {r.city}{r.district ? ` / ${r.district}` : ""} • {r.dateFrom} – {r.dateTo} • {nights} gece
            </p>
          </div>

          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-emerald-400"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Talep Detayı */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Talep detayları</p>
            <div className="grid gap-2 md:grid-cols-2">
              <Mini label="Kişi" value={`${totalPax} (Y:${r.paxAdults} • Ç:${r.paxChildren ?? 0})`} />
              <Mini label="İçerik" value={includesLabel(r.include)} />
              <Mini label="Bütçe" value={`${r.budgetMin != null ? r.budgetMin : "—"} – ${r.budgetMax != null ? r.budgetMax : "—"} ₺`} />
              <Mini label="Konaklama tipleri" value={r.boardTypes?.length ? r.boardTypes.join(", ") : "—"} />
            </div>

            {r.notes && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[0.8rem] text-slate-200">
                <span className="text-slate-400">Not:</span> {r.notes}
              </div>
            )}

            <div className="text-[0.7rem] text-slate-500">
              Talep sahibi: {r.createdByRole === "agency" ? "Acenta" : "Misafir"} • {safeStr(r.createdByName, "—")}
            </div>
          </div>

          {/* Teklif Formu */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[0.75rem] text-slate-400">Teklif ver / güncelle</p>
                <p className="text-sm font-semibold text-slate-100">Toplam ve paket detayları</p>
              </div>
              {props.myOffer ? (
                <span className="text-[0.75rem] text-emerald-300">Mevcut teklif var</span>
              ) : (
                <span className="text-[0.75rem] text-slate-400">Yeni teklif</span>
              )}
            </div>

            {(props.offerMsg || props.offerErr) && (
              <div className="space-y-2">
                {props.offerMsg && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200 text-sm">
                    {props.offerMsg}
                  </div>
                )}
                {props.offerErr && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200 text-sm">
                    {props.offerErr}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-slate-200">Toplam fiyat</label>
                <input value={props.offerTotal} onChange={(e) => props.setOfferTotal(e.target.value)} className="input" placeholder="14900" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Para birimi</label>
                <select value={props.currency} onChange={(e) => props.setCurrency(e.target.value)} className="input">
                  <option value="TRY">TRY</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Otel</label>
                <input value={props.bHotel} onChange={(e) => props.setBHotel(e.target.value)} className="input" placeholder="9000" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Transfer</label>
                <input value={props.bTransfer} onChange={(e) => props.setBTransfer(e.target.value)} className="input" placeholder="2500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Turlar</label>
                <input value={props.bTours} onChange={(e) => props.setBTours(e.target.value)} className="input" placeholder="3000" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Diğer</label>
                <input value={props.bOther} onChange={(e) => props.setBOther(e.target.value)} className="input" placeholder="400" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Otel adı</label>
                <input value={props.dHotelName} onChange={(e) => props.setDHotelName(e.target.value)} className="input" placeholder="Hotel adı" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Oda tipi</label>
                <input value={props.dRoomType} onChange={(e) => props.setDRoomType(e.target.value)} className="input" placeholder="Deluxe" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Konaklama tipi</label>
                <input value={props.dBoardType} onChange={(e) => props.setDBoardType(e.target.value)} className="input" placeholder="BB" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Transfer tipi</label>
                <input value={props.dTransferType} onChange={(e) => props.setDTransferType(e.target.value)} className="input" placeholder="VIP / Shuttle" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Tur planı (satır satır)</label>
              <textarea value={props.dTourPlan} onChange={(e) => props.setDTourPlan(e.target.value)} className="input h-28 text-xs" placeholder={"Uzungöl\nAyder\nSümela"} />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input type="checkbox" checked={props.dGuideIncluded} onChange={(e) => props.setDGuideIncluded(e.target.checked)} />
              Rehber dahil
            </label>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Not (opsiyonel)</label>
              <textarea value={props.note} onChange={(e) => props.setNote(e.target.value)} className="input h-24 text-xs" placeholder="Şartlar / açıklama" />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-md border border-slate-700 px-4 py-2 text-[0.85rem] text-slate-200 hover:border-slate-500"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={props.onSave}
                disabled={props.offerSaving}
                className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.85rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                {props.offerSaving ? "Kaydediliyor..." : props.myOffer ? "Teklifi güncelle" : "Teklif gönder"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400">{label}</p>
      <p className="text-sm text-slate-100 mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
