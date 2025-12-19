// app/guest/payments/[offerId]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";

const MODE_LABEL_PUBLIC: Record<OfferMode, string> = {
  simple: "Standart teklif",
  refreshable: "Yenilenebilir teklif",
  negotiable: "Pazarlıklı teklif"
};

interface GuestOffer {
  id: string;
  requestId: string;
  hotelId: string;
  hotelName?: string | null;
  totalPrice: number;
  currency: string;
  mode: OfferMode;
  note?: string | null;
  status: string;
  createdAt?: Timestamp;
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
}

interface PaymentOptions {
  card?: boolean;
  bankTransfer?: boolean; // şimdilik kullanmıyoruz
  payAtHotel?: boolean;
  iban?: string;
  bankName?: string;
  accountName?: string;
}

interface HotelProfile {
  address?: string;
  starRating?: number;
  paymentOptions?: PaymentOptions;
}

interface HotelInfo {
  id: string;
  displayName?: string;
  email?: string;
  hotelProfile?: HotelProfile;
}

type PaymentMethod = "card3d" | "payAtHotel";

export default function OfferPaymentPage() {
  const params = useParams<{ offerId: string }>();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const offerId = params.offerId;

  const [offer, setOffer] = useState<GuestOffer | null>(null);
  const [req, setReq] = useState<RequestSummary | null>(null);
  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 3D secure simülasyon modal state
  const [threeDSOpen, setThreeDSOpen] = useState(false);

  // Teklif + talep + otel bilgilerini yükle
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile) {
        setLoading(false);
        return;
      }
      if (!offerId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // offer
        const offerSnap = await getDoc(doc(db, "offers", offerId));
        if (!offerSnap.exists()) {
          setError("Teklif bulunamadı.");
          setLoading(false);
          return;
        }
        const oData = offerSnap.data() as any;
        const offerObj: GuestOffer = {
          id: offerSnap.id,
          requestId: oData.requestId,
          hotelId: oData.hotelId,
          hotelName: oData.hotelName ?? null,
          totalPrice: oData.totalPrice,
          currency: oData.currency,
          mode: oData.mode as OfferMode,
          note: oData.note ?? null,
          status: oData.status ?? "sent",
          createdAt: oData.createdAt,
          guestCounterPrice: oData.guestCounterPrice ?? null
        };
        setOffer(offerObj);

        // request
        const reqSnap = await getDoc(doc(db, "requests", oData.requestId));
        if (reqSnap.exists()) {
          const v = reqSnap.data() as any;
          setReq({
            id: reqSnap.id,
            city: v.city,
            district: v.district ?? null,
            checkIn: v.checkIn,
            checkOut: v.checkOut,
            adults: v.adults,
            childrenCount: v.childrenCount ?? 0,
            roomsCount: v.roomsCount ?? 1
          });
        }

        // hotel
        const hotelSnap = await getDoc(doc(db, "users", oData.hotelId));
        if (hotelSnap.exists()) {
          const h = hotelSnap.data() as any;
          setHotel({
            id: hotelSnap.id,
            displayName: h.displayName,
            email: h.email,
            hotelProfile: h.hotelProfile as HotelProfile | undefined
          });
        }
      } catch (err) {
        console.error("Ödeme sayfası verileri yüklenirken hata:", err);
        setError("Ödeme verileri yüklenirken bir hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db, offerId]);

  const paymentOptions: PaymentOptions | undefined =
    hotel?.hotelProfile?.paymentOptions;

  // Asıl rezervasyon / booking yaratma fonksiyonu
  async function completeBooking(finalPaymentMethod: PaymentMethod) {
    if (!offer || !req || !hotel) {
      setError("Teklif veya talep bilgisi eksik.");
      return;
    }

    try {
      setSaving(true);

      const bookingRef = await addDoc(collection(db, "bookings"), {
        offerId: offer.id,
        requestId: req.id,
        guestId: profile?.uid,
        hotelId: hotel.id,
        hotelName: hotel.displayName || offer.hotelName || null,
        city: req.city,
        district: req.district ?? null,
        checkIn: req.checkIn,
        checkOut: req.checkOut,
        adults: req.adults,
        childrenCount: req.childrenCount ?? 0,
        roomsCount: req.roomsCount ?? 1,
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        paymentMethod: finalPaymentMethod,
        paymentStatus:
          finalPaymentMethod === "card3d"
            ? "paid"
            : "payAtHotel",
        createdAt: serverTimestamp(),
        status: "active"
      });

      await updateDoc(doc(db, "offers", offer.id), {
        status: "accepted",
        acceptedAt: serverTimestamp(),
        bookingId: bookingRef.id
      });

      setMessage(
        "Rezervasyonun oluşturuldu. Rezervasyonlarım sayfasından detayları görebilirsin."
      );

      setTimeout(() => {
        router.push("/guest/bookings");
      }, 1500);
    } catch (err) {
      console.error("Rezervasyon oluşturulurken hata:", err);
      setError("Rezervasyon oluşturulurken bir hata oluştu. Lütfen tekrar dene.");
    } finally {
      setSaving(false);
      setThreeDSOpen(false);
    }
  }

  async function handleCompleteReservation() {
    setError(null);
    setMessage(null);

    if (!offer || !req || !hotel || !paymentMethod) {
      setError("Lütfen bir ödeme yöntemi seçin.");
      return;
    }

    if (paymentMethod === "card3d") {
      // Kart bilgisi kontrolü (MVP – sadece doldurulmuş mu bakıyoruz)
      if (!cardName || !cardNumber || !cardExpiry || !cardCvc) {
        setError("3D Secure için kart bilgilerini doldurun.");
        return;
      }
      // 3D Secure simülasyon modalini aç
      setThreeDSOpen(true);
      return;
    }

    if (paymentMethod === "payAtHotel") {
      await completeBooking("payAtHotel");
    }
  }

  if (loading) {
    return (
      <Protected allowedRoles={["guest"]}>
        <div className="container-page">
          <p className="text-sm text-slate-400">Ödeme sayfası hazırlanıyor...</p>
        </div>
      </Protected>
    );
  }

  if (!offer || !req || !hotel) {
    return (
      <Protected allowedRoles={["guest"]}>
        <div className="container-page">
          <p className="text-sm text-red-400">
            Teklif veya talep bilgisi bulunamadı. Lütfen tekrar deneyin.
          </p>
        </div>
      </Protected>
    );
  }

  const hp = hotel.hotelProfile;

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-4xl space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Ödeme & rezervasyon</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            {hotel.displayName || offer.hotelName} oteline ait bu teklifi seçtin. Aşağıdan
            ödeme yöntemini seçip rezervasyonunu tamamlayabilirsin. Ödemeye ilerlemeden sadece
            &quot;teklifi görmüş&quot; sayılırsın, gerçek rezervasyon ödeme adımında oluşur.
          </p>
        </section>

        {/* Özet kartları */}
        <section className="grid md:grid-cols-[1.4fr_minmax(0,1.2fr)] gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-slate-100">
              {hotel.displayName || offer.hotelName || "Otel"}
            </h2>
            {hp?.address && (
              <p className="text-[0.75rem] text-slate-300">
                <span className="text-slate-400">Adres: </span>
                {hp.address}
              </p>
            )}
            <p className="text-[0.75rem] text-slate-300">
              {req.city}
              {req.district ? ` / ${req.district}` : ""} • {req.checkIn} –{" "}
              {req.checkOut}
            </p>
            <p className="text-[0.75rem] text-slate-300">
              {req.adults + (req.childrenCount || 0)} kişi • {req.roomsCount || 1} oda
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-2">
            <p className="text-slate-400 text-[0.75rem] mb-0.5">Seçilen teklif</p>
            <p className="text-slate-100">
              <span className="font-semibold text-lg">
                {offer.totalPrice} {offer.currency}
              </span>{" "}
              • {MODE_LABEL_PUBLIC[offer.mode]}
            </p>
            {offer.guestCounterPrice && (
              <p className="text-[0.75rem] text-slate-300">
                Gönderdiğin karşı teklif:{" "}
                <span className="font-semibold">
                  {offer.guestCounterPrice} {offer.currency}
                </span>
              </p>
            )}
            {offer.note && (
              <p className="text-[0.75rem] text-slate-300">
                <span className="text-slate-400">Otelin notu: </span>
                {offer.note}
              </p>
            )}
          </div>
        </section>

        {/* ÖDEME YÖNTEMLERİ */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-4 text-xs">
          <h2 className="text-sm font-semibold text-slate-100 mb-1">
            Ödeme yöntemini seç
          </h2>

          {!hp?.paymentOptions && (
            <p className="text-[0.75rem] text-red-300">
              Bu otel için ödeme seçenekleri henüz tanımlanmamış. Lütfen tesisle doğrudan
              iletişime geçin.
            </p>
          )}

          <div className="space-y-2">
            {hp?.paymentOptions?.card && (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="card3d"
                  checked={paymentMethod === "card3d"}
                  onChange={() => setPaymentMethod("card3d")}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <p className="text-slate-100 text-[0.8rem] font-semibold">
                    💳 3D Secure ile kart ödemesi
                  </p>
                  <p className="text-[0.75rem] text-slate-400">
                    Kart bilgilerini girersin, bankanın 3D doğrulama ekranına yönlendirilirsin.
                    Doğrulama başarılı olursa rezervasyonun &quot;ödenmiş&quot; olur.
                  </p>
                </div>
              </label>
            )}

            {hp?.paymentOptions?.payAtHotel && (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="payAtHotel"
                  checked={paymentMethod === "payAtHotel"}
                  onChange={() => setPaymentMethod("payAtHotel")}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <p className="text-slate-100 text-[0.8rem] font-semibold">
                    💵 Otelde ödeme
                  </p>
                  <p className="text-[0.75rem] text-slate-400">
                    Kart veya havale yerine ödemeyi otele girişte yaparsın. Otel bu yöntemi
                    kabul ettiği sürece rezervasyonun &quot;ödemesi otelde&quot; statüsünde
                    açılır.
                  </p>
                </div>
              </label>
            )}
          </div>

          {/* Kart alanları (3D için) */}
          {paymentMethod === "card3d" && (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Kart üzerindeki ad
                </label>
                <input
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="Ad Soyad"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Kart numarası
                </label>
                <input
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="1111 2222 3333 4444"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Son kullanma (AA/YY)
                </label>
                <input
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(e.target.value)}
                  placeholder="12/29"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">CVC</label>
                <input
                  value={cardCvc}
                  onChange={(e) => setCardCvc(e.target.value)}
                  placeholder="123"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>
          )}

          {paymentMethod === "payAtHotel" && (
            <div className="mt-2 space-y-1">
              <p className="text-[0.75rem] text-slate-300">
                Bu seçenekte ödeme otelde, check-in sırasında yapılır. Biddakika ve otel,
                no-show (gelmeme) gibi durumlarda belirli şartlar koyabilir; bunlar ileride
                sözleşme metninde yer alacak.
              </p>
            </div>
          )}
        </section>

        {/* Hata / mesaj */}
        {error && (
          <p className="text-[0.75rem] text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        {message && (
          <p className="text-[0.75rem] text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
            {message}
          </p>
        )}

        {/* Tamamlama butonu */}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving || !paymentMethod}
            onClick={handleCompleteReservation}
            className="rounded-xl bg-emerald-500 text-slate-950 px-5 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60"
          >
            Rezervasyonu tamamla
          </button>
        </div>

        {/* 3D Secure simülasyon modali */}
        {threeDSOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="bg-slate-950/95 rounded-2xl border border-slate-800 p-5 w-full max-w-md text-xs space-y-3 shadow-xl shadow-slate-950/60">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Banka 3D Secure doğrulama
              </h2>
              <p className="text-[0.75rem] text-slate-300">
                Bu ekran, gerçek ortamda bankanın 3D Secure sayfası olacaktır. MVP&apos;de
                simülasyon yapıyoruz. Onaylarsan ödeme &quot;başarılı&quot; kabul edilip
                rezervasyonun oluşturulacak.
              </p>
              <div className="space-y-1">
                <p className="text-[0.75rem] text-slate-200">
                  {offer.totalPrice} {offer.currency} tutarında ödeme yapmayı onaylıyor
                  musun?
                </p>
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setThreeDSOpen(false)}
                  className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
                >
                  İptal
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => completeBooking("card3d")}
                  className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
                >
                  Ödemeyi onayla
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Protected>
  );
}
