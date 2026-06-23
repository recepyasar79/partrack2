// Misafir araç "halen içeride" mantığı — MisafirAraclar listesi ve Akşam
// Kontrolü ekranlarında ortak kullanılır (tek kaynak, görsel tutarlılık).

export function bugunStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Halen içeride" = ŞU AN kaydın giriş–çıkış aralığında (baslangic <= now <= bitis).
// Saat-duyarlı: araç "Çıkış Yap" ile çıktığında misafir kaydının bitis_tarihi
// (çıkış saati) o ana çekilir → araç misafir listesinde de "içeride"den düşer.
export function icerideMi(m, now = new Date()) {
  const b = m.baslangic_tarihi ? new Date(m.baslangic_tarihi) : null;
  const e = m.bitis_tarihi ? new Date(m.bitis_tarihi) : null;
  if (!b || !e || Number.isNaN(b.getTime()) || Number.isNaN(e.getTime())) return false;
  return b <= now && now <= e;
}
