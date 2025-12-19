# Biddakika MVP

Next.js 14 + TypeScript + Firebase tabanlı, talep-teklif modeli ile çalışan konaklama platformu
iskeleti.

## Kurulum

```bash
npm install
# veya
yarn
```

Ardından `.env.local.example` dosyasını kopyalayın:

```bash
cp .env.local.example .env.local
```

Ve kendi Firebase projenizin client config değerlerini doldurun.

Geliştirme sunucusunu başlatmak için:

```bash
npm run dev
```

veya

```bash
yarn dev
```

## Mimarinin Özeti

- `app/`:
  - `page.tsx`: Landing / nasıl çalışır sayfası
  - `auth/`: Kayıt ve giriş ekranları
  - `dashboard/guest`: Misafir paneli
  - `dashboard/hotel`: Otel paneli
  - `dashboard/agency`: Acenta paneli (ileriki fazlar için hazırlıklı)
  - `guest/requests/*`: Talep oluşturma ve listeleme sayfaları
  - `guest/offers`: Gelen tekliflerin listesi
  - `hotel/requests/inbox`: Oteller için gelen talepler
  - `hotel/offers`: Verilen tekliflerin listesi
  - `hotel/profile`: Otel profil yönetimi
  - `admin`: Admin panel giriş sayfası iskeleti

- `lib/firebase`: Firebase client ve auth yardımcıları
- `context/AuthContext`: Oturum ve kullanıcı rolü yönetimi
- `components/Protected`: Rol bazlı sayfa koruma bileşeni
- `types/biddakika.ts`: Temel tipler (kullanıcı, talep, teklif, roller vb.)

Bu yapı; konuştuğumuz misafir, otel ve acenta akışlarının büyük kısmını kapsayacak şekilde
genişletilebilir, güvenli ve mantıksal olarak ayrıştırılmış bir iskelet sunar.
