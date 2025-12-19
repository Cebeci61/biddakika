// app/hotel/offers/page.tsx
"use client";

// Dosyanın en üstünde zaten yoksa ekle:
import { getDoc } from "firebase/firestore";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  doc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";

interface HotelOffer {
  id: string;
  requestId: string;
  totalPrice: number;
  currency: string;
  mode: OfferMode;
  note?: string | null;
  status: string; // sent | accepted | rejected | countered
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  guestCounterPrice?: number | null;
}

interface RequestSummary {
  id: string;
  city: string;
  district?: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount?: number;
  roomsCount?: number;
  createdAt?: Timestamp;
  responseDeadlineMinutes?: number;
}

const MODE_LABEL: Record<OfferMode, string> = {
  simple: "%8 – Standart teklif",
  refreshable: "%10 – Yenilenebilir teklif",
  negotiable: "%15 – Pazarlıklı teklif"
};

function commissionRateForMode(mode: OfferMode): 8 | 10 | 15 {
  if (mode === "simple") return 8;
  if (mode === "refreshable") return 10;
  return 15;
}

function parseDate(value?: string): Date | null {
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

function isRequestExpired(req: RequestSummary): boolean {
  const created = req.createdAt?.toDate();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return false;
  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  return deadline.getTime() < Date.now();
}

function statusLabel(status: string) {
  switch (status) {
    case "accepted":
      return "Misafir kabul etti";
    case "rejected":
      return "Reddedildi / iptal";
    case "countered":
      return "Misafir karşı teklif verdi";
    case "sent":
    default:
      return "Gönderildi / beklemede";
  }
}

export default function HotelOffersPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [offers, setOffers] = useState<HotelOffer[]>([]);
  const [requestsMap, setRequestsMap] = useState<Record<string, RequestSummary>>({});
  const [bookedRequestIds, setBookedRequestIds] = useState<Set<string>>(
    () => new Set()
  );
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "sent" | "accepted" | "rejected"
  >("all");
  const [modeFilter, setModeFilter] = useState<"all" | OfferMode>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsOffer, setDetailsOffer] = useState<HotelOffer | null>(null);

  // fiyat güncelleme
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<string>("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // pagination
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  // Teklifleri + ilgili talepleri Firestore'dan çek
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "hotel") {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // 1) Bu otele ait teklifler
        const qOffers = query(
          collection(db, "offers"),
          where("hotelId", "==", profile.uid)
        );
        const snapOffers = await getDocs(qOffers);
        let offersData: HotelOffer[] = snapOffers.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            totalPrice: v.totalPrice,
            currency: v.currency,
            mode: v.mode as OfferMode,
            note: v.note ?? null,
            status: v.status ?? "sent",
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
            guestCounterPrice: v.guestCounterPrice ?? null
          };
        });

        // 2) İlgili talepler
        const requestIds = Array.from(
          new Set(offersData.map((o) => o.requestId).filter(Boolean))
        );
        let requestsData: RequestSummary[] = [];
        if (requestIds.length > 0) {
          const snapReq = await getDocs(collection(db, "requests"));
          requestsData = snapReq.docs
            .filter((d) => requestIds.includes(d.id))
            .map((d) => {
              const v = d.data() as any;
              return {
                id: d.id,
                city: v.city,
                district: v.district ?? null,
                checkIn: v.checkIn,
                checkOut: v.checkOut,
                adults: v.adults,
                childrenCount: v.childrenCount ?? 0,
                roomsCount: v.roomsCount ?? 1,
                createdAt: v.createdAt,
                responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60
              };
            });
        }

        const reqMap: Record<string, RequestSummary> = {};
        for (const r of requestsData) reqMap[r.id] = r;

        // 3) Rezervasyona dönmüş talepler (herhangi bir otel)
        const snapBookings = await getDocs(collection(db, "bookings"));
        const bookedSet = new Set<string>();
        snapBookings.docs.forEach((d) => {
          const v = d.data() as any;
          if (v.requestId) bookedSet.add(v.requestId as string);
        });

        // 4) Filtre: rezervasyona dönmüş + süresi dolmuş taleplere ait teklifler hariç
        offersData = offersData.filter((o) => {
          const req = reqMap[o.requestId];

          // Bu request için herhangi bir booking varsa → gösterme
          if (bookedSet.has(o.requestId)) return false;

          // Bu otelin accepted teklifleride bu sayfada görünmesin
          if (o.status === "accepted") return false;

          // Request süresi dolmuşsa bu teklifi gösterme
          if (req && isRequestExpired(req)) return false;

          return true;
        });

        // En yeni en üstte
        offersData = offersData.sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return tb - ta;
        });

        setOffers(offersData);
        setRequestsMap(reqMap);
        setBookedRequestIds(bookedSet);
        setPage(1); // yeni yüklemede 1. sayfaya dön
      } catch (err) {
        console.error("Verdiğim teklifler yüklenirken hata:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);
  // Filtrelenmiş teklifler
  const filteredOffers = useMemo(() => {
    return offers.filter((o) => {
      if (statusFilter !== "all") {
        if (o.status !== statusFilter) return false;
      }
      if (modeFilter !== "all") {
        if (o.mode !== modeFilter) return false;
      }

      if (fromDate) {
        if (!o.createdAt) return false;
        const createdDate = o.createdAt.toDate().toISOString().slice(0, 10);
        if (createdDate < fromDate) return false;
      }
      if (toDate) {
        if (!o.createdAt) return false;
        const createdDate = o.createdAt.toDate().toISOString().slice(0, 10);
        if (createdDate > toDate) return false;
      }

      return true;
    });
  }, [offers, statusFilter, modeFilter, fromDate, toDate]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredOffers.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageOffers = useMemo(() => {
    const start = (currentPage - 1) * PER_PAGE;
    const end = start + PER_PAGE;
    return filteredOffers.slice(start, end);
  }, [filteredOffers, currentPage]);

  function openDetails(o: HotelOffer) {
    setDetailsOffer(o);
    setDetailsOpen(true);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsOffer(null);
  }

  // Fiyat düzenleme izinleri:
  function canEditPrice(o: HotelOffer): boolean {
    if (o.status !== "sent" && o.status !== "countered") return false;
    // simple (%8) → düzenlenemez
    if (o.mode === "simple") return false;
    // refreshable (%10) ve negotiable (%15) → düzenlenebilir
    return true;
  }

  function startEdit(o: HotelOffer) {
    if (!canEditPrice(o)) return;
    setEditingId(o.id);
    setEditingPrice(String(o.totalPrice));
    setUpdateError(null);
    setUpdateMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingPrice("");
  }

  async function handleUpdatePrice(e: FormEvent<HTMLFormElement>, offer: HotelOffer) {
    e.preventDefault();
    if (!editingId) return;

    const newPrice = Number(editingPrice);
    if (isNaN(newPrice) || newPrice <= 0) {
      setUpdateError("Lütfen geçerli bir fiyat girin.");
      return;
    }

    try {
      setSavingPrice(true);
      const ref = doc(db, "offers", offer.id);
      await updateDoc(ref, {
        totalPrice: newPrice,
        updatedAt: serverTimestamp()
      });

      // lokal state'i de güncelle
      setOffers((prev) =>
        prev.map((o) =>
          o.id === offer.id ? { ...o, totalPrice: newPrice, updatedAt: Timestamp.fromDate(new Date()) } : o
        )
      );

      setUpdateMessage("Fiyat başarıyla güncellendi.");
      setEditingId(null);
      setEditingPrice("");
    } catch (err) {
      console.error("Fiyat güncellenirken hata:", err);
      setUpdateError("Fiyat güncellenirken bir hata oluştu.");
    } finally {
      setSavingPrice(false);
    }
  }

  function handleChangePage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
  }

  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-6 relative">
        {/* Başlık */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Verdiğim teklifler</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Otel olarak misafir taleplerine verdiğin tüm teklifleri burada
            görürsün. %8 tekliflerde fiyat sabittir, %10 tekliflerde cevap
            süresi içinde fiyatı güncelleyebilirsin, %15 pazarlıklı tekliflerde
            ise misafir bir kez karşı teklif gönderebilir ve yeni fiyata göre
            karar verebilirsin.
          </p>
        </section>

        {/* Filtre paneli */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Teklif durumu
              </label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as any);
                  setPage(1);
                }}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Hepsi</option>
                <option value="sent">Gönderildi / beklemede</option>
                <option value="accepted">Kabul edildi</option>
                <option value="rejected">Reddedildi / iptal</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Komisyon modeli
              </label>
              <select
                value={modeFilter}
                onChange={(e) => {
                  setModeFilter(e.target.value as any);
                  setPage(1);
                }}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Hepsi</option>
                <option value="simple">%8 – Standart</option>
                <option value="refreshable">%10 – Yenilenebilir</option>
                <option value="negotiable">%15 – Pazarlıklı</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Tarih (ilk)</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Tarih (son)</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>
          </div>
        </section>

        {/* Liste */}
        {loading && (
          <p className="text-sm text-slate-400">Teklifler yükleniyor...</p>
        )}

        {!loading && filteredOffers.length === 0 && (
          <p className="text-sm text-slate-400">
            Henüz bir teklif göndermemişsin veya filtrelere uyan teklif yok.
          </p>
        )}

        {pageOffers.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden shadow shadow-slate-950/40 text-xs">
            {/* header */}
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_1.1fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-2">
              <div>Konum / tarih</div>
              <div>Toplam fiyat</div>
              <div>Komisyon modeli</div>
              <div>Durum</div>
              <div className="text-right">İşlemler</div>
            </div>

            {pageOffers.map((o) => {
              const req = requestsMap[o.requestId];
              const createdStr = o.createdAt
                ? o.createdAt.toDate().toLocaleString()
                : "";
              const updatedStr = o.updatedAt
                ? o.updatedAt.toDate().toLocaleString()
                : "";

              const isEditing = editingId === o.id;
              const editable = canEditPrice(o);
              const commissionRate = commissionRateForMode(o.mode);

              return (
                <div key={o.id} className="border-t border-slate-800">
                  <div className="grid md:grid-cols-[1.6fr_1fr_1.1fr_1.2fr_auto] gap-2 px-4 py-3 items-center">
                    {/* Konum / tarih */}
                    <div className="text-slate-100">
                      <div className="md:hidden text-[0.7rem] text-slate-400">
                        Konum / tarih
                      </div>
                      {req ? (
                        <>
                          <div className="text-sm">
                            {req.city}
                            {req.district ? ` / ${req.district}` : ""}
                          </div>
                          <div className="text-[0.7rem] text-slate-400">
                            {req.checkIn} – {req.checkOut}
                          </div>
                          <div className="text-[0.7rem] text-slate-400">
                            {req.adults} yetişkin
                            {req.childrenCount && req.childrenCount > 0
                              ? ` • ${req.childrenCount} çocuk`
                              : ""}{" "}
                            • {req.roomsCount || 1} oda
                          </div>
                        </>
                      ) : (
                        <div className="text-[0.7rem] text-slate-400">
                          İlgili talep bilgisi bulunamadı.
                        </div>
                      )}
                    </div>

                    {/* Fiyat */}
                    <div className="text-slate-100">
                      <div className="md:hidden text-[0.7rem] text-slate-400">
                        Toplam fiyat
                      </div>

                      {!isEditing && (
                        <>
                          <div className="font-semibold text-sm">
                            {o.totalPrice} {o.currency}
                          </div>
                          <div className="text-[0.7rem] text-slate-400">
                            {createdStr && `Gönderim: ${createdStr}`}
                            {updatedStr && (
                              <> • Güncelleme: {updatedStr}</>
                            )}
                          </div>
                        </>
                      )}

                      {isEditing && (
                        <form
                          onSubmit={(e) => handleUpdatePrice(e, o)}
                          className="flex flex-col gap-1"
                        >
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={editingPrice}
                            onChange={(e) => setEditingPrice(e.target.value)}
                            className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                          />
                          <div className="flex gap-1">
                            <button
                              type="submit"
                              disabled={savingPrice}
                              className="rounded-md bg-emerald-500 text-slate-950 px-2 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
                            >
                              Kaydet
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-md border border-slate-700 px-2 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
                            >
                              İptal
                            </button>
                          </div>
                        </form>
                      )}
                    </div>

                    {/* Komisyon modeli */}
                    <div className="text-slate-100">
                      <div className="md:hidden text-[0.7rem] text-slate-400">
                        Komisyon modeli
                      </div>
                      <div>{MODE_LABEL[o.mode]}</div>
                      {commissionRate === 8 && (
                        <p className="text-[0.65rem] text-slate-500">
                          Bu modelde fiyat sabittir, değiştirilemez.
                        </p>
                      )}
                      {commissionRate === 10 && (
                        <p className="text-[0.65rem] text-slate-500">
                          Cevap süresi içinde fiyatı güncelleyebilirsin.
                        </p>
                      )}
                      {commissionRate === 15 && (
                        <p className="text-[0.65rem] text-slate-500">
                          Misafir bir kez karşı teklif gönderebilir; pazarlık
                          modeli.
                        </p>
                      )}
                    </div>

                    {/* Durum */}
                    <div className="space-y-1">
                      <div className="md:hidden text-[0.7rem] text-slate-400">
                        Durum
                      </div>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${
                          o.status === "accepted"
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                            : o.status === "rejected"
                            ? "bg-red-500/10 text-red-300 border-red-500/40"
                            : o.status === "countered"
                            ? "bg-amber-500/10 text-amber-300 border-amber-500/40"
                            : "bg-slate-500/10 text-slate-300 border-slate-500/40"
                        }`}
                      >
                        {statusLabel(o.status)}
                      </span>
                      {o.guestCounterPrice && (
                        <p className="text-[0.7rem] text-slate-400">
                          Misafir karşı teklifi: {o.guestCounterPrice}{" "}
                          {o.currency}
                        </p>
                      )}
                    </div>

                    {/* İşlemler */}
                    <div className="flex justify-end gap-2">
                      {editable && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(o)}
                          className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Fiyatı düzenle
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openDetails(o)}
                        className="rounded-md bg-sky-500 text-white px-3 py-1 text-[0.7rem] font-semibold hover:bg-sky-400"
                      >
                        Detay
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Pagination */}
        {filteredOffers.length > PER_PAGE && (
          <div className="flex justify-center items-center gap-2 text-[0.8rem] mt-2">
            <button
              type="button"
              onClick={() => handleChangePage(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 disabled:opacity-40 hover:border-emerald-400"
            >
              Önceki
            </button>
            {Array.from({ length: totalPages }).map((_, idx) => {
              const p = idx + 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleChangePage(p)}
                  className={`px-2 py-1 rounded-md border text-[0.8rem] ${
                    p === currentPage
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-700 text-slate-200 hover:border-emerald-400"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => handleChangePage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-2 py-1 rounded-md border border-slate-700 text-slate-200 disabled:opacity-40 hover:border-emerald-400"
            >
              Sonraki
            </button>
          </div>
        )}

        {/* Genel update mesajları */}
        {(updateMessage || updateError) && (
          <div className="text-[0.7rem] space-y-1">
            {updateMessage && (
              <p className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
                {updateMessage}
              </p>
            )}
            {updateError && (
              <p className="text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
                {updateError}
              </p>
            )}
          </div>
        )}

        {/* DETAY MODAL */}
        {detailsOpen && detailsOffer && (
          <OfferDetailModal
            offer={detailsOffer}
            request={requestsMap[detailsOffer.requestId]}
            onClose={closeDetails}
          />
        )}
      </div>
    </Protected>
  );
}
/* ------------------------ GELİŞMİŞ TEKLİF DETAY MODAL (TAM + FULL FETCH) ------------------------ */

function OfferDetailModal({
  offer,
  request,
  onClose
}: {
  offer: HotelOffer;
  request?: RequestSummary;
  onClose: () => void;
}) {
  const offerAny = offer as any;

  // 🔥 Modal açılınca “tam talep dokümanı” + “otel profil oda tipleri” çekiyoruz
  const db = getFirestoreDb();

  const [fullReq, setFullReq] = useState<any | null>(request ?? null);
  const [reqLoading, setReqLoading] = useState<boolean>(true);

  const [hotelRoomTypes, setHotelRoomTypes] = useState<any[]>([]);
  const [hotelLoading, setHotelLoading] = useState<boolean>(true);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [activeRoomProfile, setActiveRoomProfile] = useState<any | null>(null);

  // ---- helpers ----
  function safeStr(v: any, fallback = "Belirtilmemiş") {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s.length ? s : fallback;
  }

  function toDateMaybe(ts: any): Date | null {
    try {
      if (!ts) return null;
      if (typeof ts?.toDate === "function") return ts.toDate();
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  function fmtDateTime(ts: any) {
    const d = toDateMaybe(ts);
    return d ? d.toLocaleString("tr-TR") : "Belirtilmemiş";
  }

  function diffToCheckIn(checkInISO?: string | null) {
    if (!checkInISO) return "Belirtilmemiş";
    const d = new Date(checkInISO);
    if (Number.isNaN(d.getTime())) return "Belirtilmemiş";

    const ms = d.getTime() - Date.now();
    if (ms <= 0) return "Giriş zamanı geçti";

    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const mins = totalMin % 60;

    if (days > 0) return `${days} gün ${hours} sa ${mins} dk kaldı`;
    if (hours > 0) return `${hours} sa ${mins} dk kaldı`;
    return `${mins} dk kaldı`;
  }

  function modeText(m: any) {
    return m === "negotiable"
      ? "Pazarlıklı teklif"
      : m === "refreshable"
      ? "Yenilenebilir teklif"
      : "Standart teklif";
  }

  function statusTextLocal(s: any) {
    switch (s) {
      case "accepted":
        return "Kabul edildi (rezervasyona döndü)";
      case "rejected":
        return "Reddedildi";
      case "countered":
        return "Karşı teklif var";
      case "sent":
      default:
        return "Gönderildi";
    }
  }

  function cancelTextFromOffer(o: any) {
    const t = o?.cancellationPolicyType ?? "non_refundable";
    const d = o?.cancellationPolicyDays ?? 3;
    if (t === "non_refundable") return "İptal edilemez / iade yok.";
    if (t === "flexible") return "Giriş tarihine kadar ücretsiz iptal.";
    if (t === "until_days_before")
      return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal.`;
    return "Belirtilmemiş";
  }

  // KVKK maskeleme (rezervasyona kadar)
  function maskName(name?: string | null): string {
    if (!name) return "Misafir";
    const parts = String(name).split(" ").filter(Boolean);
    return parts
      .map((p) => p[0] + "*".repeat(Math.max(2, p.length - 1)))
      .join(" ");
  }
  function maskEmail(email?: string | null): string {
    if (!email) return "Belirtilmemiş";
    const [user, domain] = String(email).split("@");
    if (!domain) return "Belirtilmemiş";
    const maskedUser = user[0] + "*".repeat(Math.max(3, user.length - 1));
    const [domainName, ext] = domain.split(".");
    const maskedDomain =
      domainName?.[0] + "*".repeat(Math.max(3, (domainName || "").length - 1));
    return `${maskedUser}@${maskedDomain}${ext ? "." + ext : ""}`;
  }
  function maskPhone(phone?: string | null): string {
    if (!phone) return "Belirtilmemiş";
    const s = String(phone);
    const digits = s.replace(/\D/g, "");
    if (digits.length < 4) return "Belirtilmemiş";
    const last2 = digits.slice(-2);
    const prefix = s.slice(0, 4); // +90  gibi
    return `${prefix} ***** ${last2}`;
  }

  // “rezervasyon onaylandı mı?”
  const isUnlocked = offer.status === "accepted";

  // 🔥 Firestore’dan tam talep çek
  useEffect(() => {
    let alive = true;

    async function loadFull() {
      try {
        setReqLoading(true);

        // request prop zaten geldiyse onu baz al, ama “eksik alan” ihtimali var → yine de doc’u oku
        const snap = await getDoc(doc(db, "requests", offer.requestId));
        if (!alive) return;

        if (snap.exists()) {
          setFullReq({ id: snap.id, ...(snap.data() as any) });
        } else {
          setFullReq(request ?? null);
        }
      } catch (e) {
        console.error("request load error:", e);
        if (alive) setFullReq(request ?? null);
      } finally {
        if (alive) setReqLoading(false);
      }
    }

    loadFull();
    return () => {
      alive = false;
    };
  }, [db, offer.requestId]); // request değişse bile id ana belirleyici

  // 🔥 Otelin roomTypes + görsellerini çek (oda modalı için)
  useEffect(() => {
    let alive = true;

    async function loadHotel() {
      try {
        setHotelLoading(true);
        const hid = offerAny.hotelId;
        if (!hid) {
          setHotelRoomTypes([]);
          return;
        }
        const snap = await getDoc(doc(db, "users", hid));
        if (!alive) return;

        const data = snap.exists() ? (snap.data() as any) : null;
        const rt = data?.hotelProfile?.roomTypes;
        setHotelRoomTypes(Array.isArray(rt) ? rt : []);
      } catch (e) {
        console.error("hotel roomTypes load error:", e);
        if (alive) setHotelRoomTypes([]);
      } finally {
        if (alive) setHotelLoading(false);
      }
    }

    loadHotel();
    return () => {
      alive = false;
    };
  }, [db, offerAny.hotelId,]);

  const reqAny = (fullReq || {}) as any;

  // ✅ “Ad Soyad” kesin doğru olsun: contactName önce
  const contactName =
    reqAny.contactName ||
    reqAny.guestName ||
    reqAny.guestDisplayName ||
    reqAny.guestDisplayNameName ||
    reqAny.guestDisplayName ||
    null;

  const contactEmail = reqAny.contactEmail || reqAny.guestEmail || reqAny.email || null;

  const contactPhone =
    reqAny.contactPhone ||
    reqAny.guestPhone ||
    (reqAny.contactPhoneCountryCode && reqAny.contactPhoneLocal
      ? `${reqAny.contactPhoneCountryCode} ${reqAny.contactPhoneLocal}`
      : null) ||
    null;

  const contactPhone2 = reqAny.contactPhone2 || reqAny.guestPhone2 || null;

  const company = reqAny.contactCompany || reqAny.company || null;

  const nameToShow = isUnlocked ? safeStr(contactName, "Misafir") : maskName(contactName);
  const emailToShow = isUnlocked ? safeStr(contactEmail) : maskEmail(contactEmail);
  const phoneToShow = isUnlocked ? safeStr(contactPhone) : maskPhone(contactPhone);
  const phone2ToShow = contactPhone2
    ? isUnlocked
      ? safeStr(contactPhone2)
      : maskPhone(contactPhone2)
    : null;

  const companyToShow = isUnlocked ? safeStr(company) : maskName(company);

  const adults = Number(reqAny.adults ?? 0);
  const childrenCount = Number(reqAny.childrenCount ?? 0);
  const totalGuests = adults + childrenCount;

  const childrenAges: any[] = Array.isArray(reqAny.childrenAges) ? reqAny.childrenAges : [];
  const roomsCount = Number(reqAny.roomsCount ?? 1);

  const checkIn = reqAny.checkIn || reqAny.checkInDate || null;
  const checkOut = reqAny.checkOut || reqAny.checkOutDate || null;

  // Talep alanları
  const boardTypes: any[] = Array.isArray(reqAny.boardTypes) ? reqAny.boardTypes : [];
  const boardTypeSingle = reqAny.boardType || null;
  const accommodationType = reqAny.accommodationType || reqAny.accommodationTypeKey || null;

  const desiredStars: any[] = Array.isArray(reqAny.desiredStarRatings) ? reqAny.desiredStarRatings : [];
  const starRating = reqAny.starRating || null;

  const featureKeys: any[] = Array.isArray(reqAny.featureKeys) ? reqAny.featureKeys : [];
  const hotelFeaturePrefs: any[] = Array.isArray(reqAny.hotelFeaturePrefs) ? reqAny.hotelFeaturePrefs : [];

  const extraFeaturesText =
    reqAny.extraFeaturesText || reqAny.hotelFeatureNote || reqAny.hotelFeatureNoteText || null;

  const locationNote = reqAny.locationNote || null;
  const generalNote = reqAny.note || null;
  const contactNote = reqAny.contactNote || null;

  // Oda tercihleri (her format)
  const roomTypesArr: any[] = Array.isArray(reqAny.roomTypes) ? reqAny.roomTypes : [];
  const roomTypeRows: any[] = Array.isArray(reqAny.roomTypeRows) ? reqAny.roomTypeRows : [];
  const roomTypeCounts =
    reqAny.roomTypeCounts && typeof reqAny.roomTypeCounts === "object" ? reqAny.roomTypeCounts : null;

  // Oda kırılımı (teklif)
  const roomBreakdown = Array.isArray(offerAny.roomBreakdown) ? offerAny.roomBreakdown : [];

  // Oda profili bul
  function findRoomProfile(roomTypeId?: string | null, roomTypeName?: string | null) {
    if (!roomTypeId && !roomTypeName) return null;

    if (roomTypeId) {
      const hit = hotelRoomTypes.find((r) => r?.id === roomTypeId);
      if (hit) return hit;
    }
    if (roomTypeName) {
      const hit = hotelRoomTypes.find(
        (r) => String(r?.name || "").toLowerCase() === String(roomTypeName).toLowerCase()
      );
      if (hit) return hit;
    }
    return null;
  }

  function openRoomModal(rb: any) {
    const prof = findRoomProfile(rb?.roomTypeId ?? null, rb?.roomTypeName ?? null);
    setActiveRoomProfile(
      prof || {
        id: rb?.roomTypeId ?? null,
        name: rb?.roomTypeName ?? "Oda",
        shortDescription: null,
        description: null,
        maxAdults: null,
        maxChildren: null,
        imageUrls: []
      }
    );
    setRoomModalOpen(true);
  }

  function closeRoomModal() {
    setRoomModalOpen(false);
    setActiveRoomProfile(null);
  }

  // Fiyat geçmişi: varsa priceHistory, yoksa sentetik
  const priceHistory: any[] = Array.isArray(offerAny.priceHistory) ? offerAny.priceHistory : [];
  const syntheticHistory: any[] = [
    {
      at: offerAny.createdAt,
      by: "hotel",
      label: "İlk teklif",
      price: offerAny.totalPrice,
      currency: offerAny.currency
    }
  ];
  if (offerAny.guestCounterPrice) {
    syntheticHistory.push({
      at: offerAny.guestCounterAt || offerAny.updatedAt || null,
      by: "guest",
      label: "Misafir karşı teklif",
      price: offerAny.guestCounterPrice,
      currency: offerAny.currency
    });
  }
  if (offerAny.updatedAt && offerAny.updatedAt !== offerAny.createdAt) {
    syntheticHistory.push({
      at: offerAny.updatedAt,
      by: "hotel",
      label: "Son güncelleme",
      price: offerAny.totalPrice,
      currency: offerAny.currency
    });
  }
  const historyToShow = priceHistory.length > 0 ? priceHistory : syntheticHistory;

  const createdStr = fmtDateTime(offerAny.createdAt);
  const updatedStr = offerAny.updatedAt ? fmtDateTime(offerAny.updatedAt) : "";

  const commissionRate = commissionRateForMode(offer.mode);

  // ✅ “hiçbir alan boş kalmasın” için tek fallback fonksiyonu
  const fill = (v: any, fb = "Belirtilmemiş") => safeStr(v, fb);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

        <div className="relative mt-10 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[85vh] overflow-y-auto text-[0.85rem] space-y-4">
          {/* HEADER */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">Teklif Detayı</h2>

                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[0.65rem] text-slate-300">
                  {modeText(offer.mode)} • ~%{commissionRate}
                </span>

                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${
                    offer.status === "accepted"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : offer.status === "rejected"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : offer.status === "countered"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                      : "border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
                  {statusTextLocal(offer.status)}
                </span>

                {!isUnlocked && (
                  <span className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                    KVKK: Kimlik/iletişim maskeli
                  </span>
                )}
              </div>

              <p className="text-[0.7rem] text-slate-400">
                Talep:{" "}
                <span className="text-slate-200">{fill(offer.requestId).slice(0, 10)}…</span>{" "}
                • Gönderim: <span className="text-slate-200">{createdStr}</span>
                {updatedStr ? (
                  <>
                    {" "}
                    • Son güncelleme: <span className="text-slate-200">{updatedStr}</span>
                  </>
                ) : null}
              </p>

              {reqLoading && (
                <p className="text-[0.7rem] text-slate-500">
                  Talep detayları yükleniyor...
                </p>
              )}
              {hotelLoading && (
                <p className="text-[0.7rem] text-slate-500">
                  Oda profilleri yükleniyor...
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.75rem] text-slate-300 hover:border-emerald-400"
            >
              Kapat ✕
            </button>
          </div>

          {/* ÜST KARTLAR */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">Toplam fiyat</p>
              <p className="text-slate-100 text-[0.95rem] font-semibold">
                {fill(offer.totalPrice, "0")} {fill(offer.currency, "TRY")}
              </p>
              <p className="mt-1 text-[0.75rem] text-slate-400">
                Misafir karşı teklifi:{" "}
                <span className="text-amber-300 font-semibold">
                  {offerAny.guestCounterPrice ? `${offerAny.guestCounterPrice} ${offer.currency}` : "Yok"}
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">İptal politikası</p>
              <p className="text-[0.8rem] text-slate-100">{cancelTextFromOffer(offerAny)}</p>
              <p className="mt-1 text-[0.7rem] text-slate-500">
                Bu teklif için kaydedildi.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">Check-in’e kalan</p>
              <p className="text-[0.85rem] font-semibold text-emerald-300">
                {diffToCheckIn(checkIn)}
              </p>
              <p className="mt-1 text-[0.7rem] text-slate-500">
                (Giriş tarihine göre)
              </p>
            </div>
          </div>

          {/* FİYAT GEÇMİŞİ / PAZARLIK */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Fiyat geçmişi / pazarlık akışı</p>

            <div className="space-y-2">
              {historyToShow.map((h, idx) => {
                const who = h?.by || h?.actor || "hotel";
                const badge =
                  who === "guest"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

                const label = fill(h?.label || h?.event || (who === "guest" ? "Misafir" : "Otel"));
                const price = h?.price ?? h?.totalPrice ?? null;
                const currency = h?.currency ?? offer.currency;

                return (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${badge}`}>
                          {who === "guest" ? "Misafir" : "Otel"}
                        </span>
                        <span className="text-slate-100 text-[0.8rem] font-semibold">{label}</span>
                      </div>
                      <div className="text-[0.7rem] text-slate-500">{fmtDateTime(h?.at)}</div>
                      <div className="text-[0.75rem] text-slate-300 mt-1 whitespace-pre-wrap">
                        {h?.note ? String(h.note) : "Not yok."}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-slate-100 text-[0.85rem] font-semibold">
                        {price != null ? `${price} ${currency}` : "Belirtilmemiş"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ODA KIRILIMI */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Oda kırılımı (teklif)</p>

            {roomBreakdown.length === 0 ? (
              <p className="text-[0.8rem] text-slate-300">
                Bu teklifte oda kırılımı yok.
              </p>
            ) : (
              <div className="space-y-2">
                {roomBreakdown.map((rb: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="space-y-0.5">
                      <p className="text-[0.75rem] text-slate-400">Oda {idx + 1}</p>

                      <button
                        type="button"
                        onClick={() => openRoomModal(rb)}
                        className="text-left text-slate-100 font-semibold hover:text-emerald-300 hover:underline"
                        title="Oda detayını aç"
                      >
                        {fill(rb?.roomTypeName || rb?.name || "Oda")}
                      </button>

                      <p className="text-[0.7rem] text-slate-400">
                        {fill(rb?.nights, "—")} gece × {fill(rb?.nightlyPrice, "—")} {fill(offer.currency, "TRY")}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-[0.75rem] text-slate-400">Toplam</p>
                      <p className="text-[0.85rem] font-semibold text-emerald-300">
                        {fill(rb?.totalPrice, "—")} {fill(offer.currency, "TRY")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <p className="text-[0.7rem] text-slate-400">Misafire not</p>
              <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">
                {offer.note ? String(offer.note) : "Not yok."}
              </p>
            </div>
          </div>

          {/* İLGİLİ TALEP (TAM) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-3">
            <p className="text-[0.75rem] text-slate-400">
              İlgili talep (misafirin doldurduğu bilgiler - TAM)
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              {/* Konaklama */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                <p className="text-[0.7rem] text-slate-400">Konaklama</p>
                <p className="text-slate-100 font-semibold">
                  {fill(reqAny.city)}{reqAny.district ? ` / ${reqAny.district}` : ""}
                </p>
                <p className="text-[0.8rem] text-slate-200">
                  {fill(checkIn)} – {fill(checkOut)}
                </p>
                <p className="text-[0.75rem] text-slate-300">
                  {fill(totalGuests, "0")} kişi • {fill(roomsCount, "1")} oda
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Yetişkin: {fill(adults, "0")} • Çocuk: {fill(childrenCount, "0")}
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Çocuk yaşları: {childrenAges.length > 0 ? childrenAges.join(", ") : "Belirtilmemiş"}
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Yakınımda ara: {reqAny.nearMe ? "Açık" : "Kapalı"}{" "}
                  {reqAny.nearMe ? `• ${fill(reqAny.nearMeKm, "—")} km` : ""}
                </p>
              </div>

              {/* Tercihler */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <p className="text-[0.7rem] text-slate-400">Tercihler</p>

                <p className="text-[0.75rem] text-slate-300">
                  Tesis türü: <span className="text-slate-100 font-semibold">{fill(accommodationType, "Farketmez")}</span>
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Konaklama tipi:{" "}
                  <span className="text-slate-100 font-semibold">
                    {boardTypes.length > 0 ? boardTypes.join(", ") : fill(boardTypeSingle, "Farketmez")}
                  </span>
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Yıldız:{" "}
                  <span className="text-amber-300 font-semibold">
                    {starRating ? `${starRating}★` : desiredStars.length > 0 ? desiredStars.map((s: any) => `${s}★`).join(", ") : "Farketmez"}
                  </span>
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Cevap süresi:{" "}
                  <span className="text-slate-100 font-semibold">
                    {reqAny.responseTimeAmount ? `${reqAny.responseTimeAmount} ${fill(reqAny.responseTimeUnit, "")}` : "Belirtilmemiş"}
                  </span>{" "}
                  <span className="text-slate-500">
                    (toplam {fill(reqAny.responseDeadlineMinutes, "—")} dk)
                  </span>
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  Konum notu: <span className="text-slate-100">{fill(locationNote, "Not yok")}</span>
                </p>
              </div>

              {/* Oda tercihleri */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2 md:col-span-2">
                <p className="text-[0.7rem] text-slate-400">Oda tercihleri</p>

                {roomTypeRows.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {roomTypeRows.map((r: any, i: number) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.7rem] text-slate-200"
                      >
                        {fill(r?.typeKey)}: {fill(r?.count, "0")} oda
                      </span>
                    ))}
                  </div>
                ) : roomTypeCounts ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(roomTypeCounts).map(([k, v]: any) => (
                      <span
                        key={k}
                        className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.7rem] text-slate-200"
                      >
                        {k}: {v} oda
                      </span>
                    ))}
                  </div>
                ) : roomTypesArr.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {roomTypesArr.map((t: any, i: number) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.7rem] text-slate-200"
                      >
                        {String(t)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.8rem] text-slate-300">Farketmez</p>
                )}
              </div>

              {/* Özellikler */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <p className="text-[0.7rem] text-slate-400">İstenen özellikler</p>

                <p className="text-[0.75rem] text-slate-100 whitespace-pre-wrap">
                  {(featureKeys.length > 0 || hotelFeaturePrefs.length > 0)
                    ? (featureKeys.length > 0 ? featureKeys : hotelFeaturePrefs).join(", ")
                    : "Belirtilmemiş"}
                </p>

                <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[0.7rem] text-slate-400">Ek özellik notu</p>
                  <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">
                    {fill(extraFeaturesText, "Not yok")}
                  </p>
                </div>
              </div>

              {/* Notlar */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <p className="text-[0.7rem] text-slate-400">Misafir notları</p>

                <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[0.7rem] text-slate-400">Genel not</p>
                  <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">
                    {fill(generalNote, "Not yok")}
                  </p>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[0.7rem] text-slate-400">İletişim notu</p>
                  <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">
                    {fill(contactNote, "Not yok")}
                  </p>
                </div>
              </div>

              {/* İletişim (KVKK) */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2 md:col-span-2">
                <div className="flex items-center justify-between">
                  <p className="text-[0.7rem] text-slate-400">İletişim bilgileri</p>
                  <span className="text-[0.65rem] text-slate-500">
                    {isUnlocked ? "Rezervasyon sonrası açık" : "Rezervasyona kadar maskeli"}
                  </span>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <p className="text-[0.65rem] text-slate-400">Ad soyad</p>
                    <p className="text-[0.85rem] text-slate-100 font-semibold">{nameToShow}</p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <p className="text-[0.65rem] text-slate-400">Firma / kurum</p>
                    <p className="text-[0.85rem] text-slate-100">{companyToShow}</p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <p className="text-[0.65rem] text-slate-400">E-posta</p>
                    <p className="text-[0.85rem] text-slate-100">{emailToShow}</p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <p className="text-[0.65rem] text-slate-400">Telefon</p>
                    <p className="text-[0.85rem] text-slate-100">{phoneToShow}</p>
                    <p className="text-[0.75rem] text-slate-400 mt-1">
                      2. telefon: <span className="text-slate-200">{phone2ToShow ? phone2ToShow : "Belirtilmemiş"}</span>
                    </p>
                  </div>
                </div>

                <p className="text-[0.65rem] text-slate-500">
                  KVKK gereği kimlik/iletişim bilgileri rezervasyon onaylanana kadar gizlenir.
                </p>
              </div>
            </div>
          </div>

          <p className="text-[0.65rem] text-slate-500">
            Bu detay ekranı sadece otel tarafında görünür. KVKK gereği bilgiler rezervasyon sonrası açılır.
          </p>
        </div>
      </div>

      {/* ODA DETAY MODALI */}
      {roomModalOpen && activeRoomProfile && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70">
          <div className="absolute inset-0" onClick={closeRoomModal} aria-hidden="true" />
          <div className="relative mt-16 w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[80vh] overflow-y-auto space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Oda detayı: {fill(activeRoomProfile?.name, "Oda")}
                </h3>
                <p className="text-[0.75rem] text-slate-400">
                  Kapasite: {fill(activeRoomProfile?.maxAdults, "—")} yetişkin
                  {activeRoomProfile?.maxChildren != null
                    ? ` • ${activeRoomProfile.maxChildren} çocuk`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={closeRoomModal}
                className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.75rem] text-slate-300 hover:border-emerald-400"
              >
                Kapat ✕
              </button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <p className="text-[0.7rem] text-slate-400">Kısa açıklama</p>
              <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">
                {fill(activeRoomProfile?.shortDescription, "Belirtilmemiş")}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <p className="text-[0.7rem] text-slate-400">Detay</p>
              <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">
                {fill(activeRoomProfile?.description, "Belirtilmemiş")}
              </p>
            </div>

            {Array.isArray(activeRoomProfile?.imageUrls) && activeRoomProfile.imageUrls.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[0.75rem] text-slate-400">Oda görselleri</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {activeRoomProfile.imageUrls.map((u: string, i: number) => (
                    <div
                      key={i}
                      className="aspect-video rounded-lg border border-slate-800 overflow-hidden bg-slate-900"
                    >
                      <img src={u} alt={`room-${i}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[0.8rem] text-slate-400">Bu oda için görsel yok.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
